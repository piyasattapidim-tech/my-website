const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:1234@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Connected Successfully!'))
    .catch(err => console.log('MongoDB Connection Error:', err));

const userSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    email: String,
    phone: String,
    profileImage: { type: String, default: '' },
    statusMessage: { type: String, default: '' },
    fbCoins: { type: Number, default: 50 },
    friends: [{ type: String }],
    following: [{ type: String }],
    followers: [{ type: String }]
});

const User = mongoose.model('User', userSchema);

const privateMessageSchema = new mongoose.Schema({
    sender: { type: String, required: true },
    receiver: { type: String, required: true },
    message: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
const PrivateMessage = mongoose.model('PrivateMessage', privateMessageSchema);

app.post('/api/register', async (req, res) => {
    try {
        const { name, password, email, phone } = req.body;
        const existingUser = await User.findOne({ name });
        if (existingUser) return res.json({ success: false, message: 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว' });
        const newUser = new User({ name, password, email, phone });
        await newUser.save();
        res.json({ success: true, message: 'ลงทะเบียนสำเร็จ' });
    } catch (err) {
        res.json({ success: false, message: 'เกิดข้อผิดพลาดในระบบฐานข้อมูล' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { name, password } = req.body;
        const user = await User.findOne({ name, password });
        if (user) res.json({ success: true, message: 'เข้าสู่ระบบสำเร็จ', user });
        else res.json({ success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    } catch (err) {
        res.json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

app.post('/api/topup', async (req, res) => {
    try {
        const { name, amountBaht } = req.body;
        const addedCoins = (amountBaht / 10) * 50; 
        const user = await User.findOneAndUpdate(
            { name },
            { $inc: { fbCoins: addedCoins } },
            { new: true }
        );
        if (user) {
            res.json({ success: true, message: `สำเร็จ`, fbCoins: user.fbCoins });
        } else {
            res.json({ success: false, message: 'ไม่พบชื่อผู้ใช้งาน' });
        }
    } catch (err) {
        res.json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

app.get('/api/stats', async (req, res) => {
    try {
        const count = await User.countDocuments();
        res.json({ totalMembers: count });
    } catch (err) {
        res.json({ totalMembers: 0 });
    }
});

app.get('/api/users', async (req, res) => {
    try {
        const users = await User.find({}, 'name profileImage statusMessage fbCoins friends following followers');
        res.json(users);
    } catch (err) {
        res.json([]);
    }
});

const onlineUsers = new Map();
const activeLiveStreams = new Map();

function broadcastLiveChannels() {
    const channels = Array.from(activeLiveStreams.entries()).map(([username, channelName]) => ({ username, channelName }));
    io.emit('live_channels_list', channels);
}

io.on('connection', (socket) => {
    socket.on('user_online', (username) => {
        if (username) {
            onlineUsers.set(username, socket.id);
            io.emit('online_users_list', Array.from(onlineUsers.keys()));
        }
    });

    socket.on('start_live', (data) => {
        if (data.username && data.channelName) {
            activeLiveStreams.set(data.username, socket.id); // บันทึก socket.id ไว้เพื่อให้ผู้ชมเรียกหาได้ถูก
            broadcastLiveChannels();
        }
    });

    socket.on('stop_live', (username) => {
        if (username) {
            activeLiveStreams.delete(username);
            broadcastLiveChannels();
        }
    });

    socket.on('get_live_channels', () => {
        const channels = Array.from(activeLiveStreams.entries()).map(([username, channelName]) => ({ username, channelName }));
        socket.emit('live_channels_list', channels);
    });

    socket.on('live_interaction', (data) => {
        io.emit('receive_live_interaction', data);
    });

    // --- ระบบ WebRTC Signaling สำหรับส่งสัญญาณกล้องไลฟ์สด ---
    socket.on('join_live_room', (data) => {
        // data = { broadcaster: ชื่อผู้ไลฟ์, viewer: ชื่อผู้ชม }
        const broadcasterSocketId = activeLiveStreams.get(data.broadcaster);
        if (broadcasterSocketId) {
            // ส่งสัญญาณไปบอกคนไลฟ์ว่ามีผู้ชมเข้ามาแล้ว ให้ส่ง Offer (สัญญาณกล้อง) มาให้หน่อย
            io.to(broadcasterSocketId).emit('request_offer', { viewerSocketId: socket.id });
        }
    });

    socket.on('send_offer', (data) => {
        // ผู้ไลฟ์ส่ง Offer กลับมาหาผู้ชม
        io.to(data.targetSocketId).emit('webrtc_offer', { offer: data.offer, senderSocketId: socket.id });
    });

    socket.on('send_answer', (data) => {
        // ผู้ชมส่ง Answer กลับไปหาผู้ไลฟ์
        io.to(data.targetSocketId).emit('webrtc_answer', { answer: data.answer });
    });

    socket.on('send_ice_candidate', (data) => {
        // ส่งเส้นทางการเชื่อมต่อเครือข่าย (ICE Candidate) หาอีกฝั่ง
        io.to(data.targetSocketId).emit('webrtc_ice_candidate', { candidate: data.candidate });
    });

    socket.on('disconnect', () => {
        for (let [username, sId] of onlineUsers.entries()) {
            if (sId === socket.id) {
                onlineUsers.delete(username);
                activeLiveStreams.delete(username);
                break;
            }
        }
        io.emit('online_users_list', Array.from(onlineUsers.keys()));
        broadcastLiveChannels();
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});