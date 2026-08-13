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
        const { name, password } = req.body;
        const existingUser = await User.findOne({ name });
        if (existingUser) return res.json({ success: false, message: 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว' });
        await new User({ name, password }).save();
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
        const user = await User.findOneAndUpdate({ name }, { $inc: { fbCoins: addedCoins } }, { new: true });
        if (user) res.json({ success: true, message: `เติมเงินสำเร็จ! ได้รับ ${addedCoins} เหรียญ FB`, fbCoins: user.fbCoins });
        else res.json({ success: false, message: 'ไม่พบชื่อผู้ใช้งานในระบบ' });
    } catch (err) {
        res.json({ success: false, message: 'เกิดข้อผิดพลาดในการเติมเหรียญ' });
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
        const users = await User.find({}, 'name statusMessage fbCoins friends following followers');
        res.json(users);
    } catch (err) {
        res.json([]);
    }
});

app.post('/api/update-profile', async (req, res) => {
    try {
        const { name, statusMessage } = req.body;
        const updatedUser = await User.findOneAndUpdate({ name }, { statusMessage }, { new: true });
        if (updatedUser) res.json({ success: true, message: 'อัปเดตสถานะสำเร็จ' });
        else res.json({ success: false, message: 'ไม่พบผู้ใช้งาน' });
    } catch (err) {
        res.json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

app.get('/api/private-messages/:userA/:userB', async (req, res) => {
    try {
        const { userA, userB } = req.params;
        const messages = await PrivateMessage.find({
            $or: [
                { sender: userA, receiver: userB },
                { sender: userB, receiver: userA }
            ]
        }).sort({ createdAt: 1 });
        res.json(messages);
    } catch (err) {
        res.json([]);
    }
});

// ระบบ Socket.io สำหรับ Real-time & Video Call / Live Signaling
const onlineUsers = new Map();
const activeLiveRooms = new Set();

io.on('connection', (socket) => {
    socket.on('user_online', (username) => {
        if (username) {
            onlineUsers.set(username, socket.id);
            io.emit('online_users_list', Array.from(onlineUsers.keys()));
            io.emit('update_live_rooms', Array.from(activeLiveRooms));
        }
    });

    socket.on('chat-message', (data) => {
        io.emit('chat-message', data);
    });

    socket.on('send_private_message', async (data) => {
        try {
            const newMessage = new PrivateMessage({
                sender: data.sender,
                receiver: data.receiver,
                message: data.message
            });
            await newMessage.save();

            const receiverSocketId = onlineUsers.get(data.receiver);
            if (receiverSocketId) {
                io.to(receiverSocketId).emit('receive_private_message', newMessage);
            }
            socket.emit('receive_private_message', newMessage);
        } catch (err) {
            console.error(err);
        }
    });

    // 🔴 จัดการระบบไลฟ์สด & เปิด/ปิดกล้อง
    socket.on('start_live', (data) => {
        activeLiveRooms.add(data.username);
        io.emit('update_live_rooms', Array.from(activeLiveRooms));
    });

    socket.on('stop_live', (data) => {
        activeLiveRooms.delete(data.username);
        io.emit('update_live_rooms', Array.from(activeLiveRooms));
    });

    // ส่งสถานะการเปิด/ปิดกล้องหรือไมค์ไปยังผู้รับชมคนอื่นในห้อง
    socket.on('toggle_media_status', (data) => {
        io.broadcast.emit('remote_media_status_changed', data);
    });

    socket.on('disconnect', () => {
        for (let [username, sId] of onlineUsers.entries()) {
            if (sId === socket.id) {
                onlineUsers.delete(username);
                activeLiveRooms.delete(username);
                break;
            }
        }
        io.emit('online_users_list', Array.from(onlineUsers.keys()));
        io.emit('update_live_rooms', Array.from(activeLiveRooms));
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});