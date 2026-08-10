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

// User Schema
const userSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    email: String,
    phone: String,
    fbCoins: { type: Number, default: 100 },
    bankDetails: {
        fullName: { type: String, default: '' },
        bankName: { type: String, default: '' },
        accountNumber: { type: String, default: '' }
    },
    following: [{ type: String }],
    followers: [{ type: String }]
});
const User = mongoose.model('User', userSchema);

// Post Schema
const postSchema = new mongoose.Schema({
    author: { type: String, required: true },
    content: { type: String, required: true },
    flowersCount: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});
const Post = mongoose.model('Post', postSchema);

// Private Message Schema
const privateMessageSchema = new mongoose.Schema({
    sender: { type: String, required: true },
    receiver: { type: String, required: true },
    message: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
const PrivateMessage = mongoose.model('PrivateMessage', privateMessageSchema);

// API Routes
app.post('/api/register', async (req, res) => {
    try {
        const { name, password } = req.body;
        const existing = await User.findOne({ name });
        if (existing) return res.json({ success: false, message: 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว' });
        const newUser = new User({ name, password });
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
        if (user) {
            res.json({ success: true, message: 'เข้าสู่ระบบสำเร็จ', user });
        } else {
            res.json({ success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
        }
    } catch (err) {
        res.json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

app.post('/api/topup', async (req, res) => {
    try {
        const { name, amountBaht } = req.body;
        const addedCoins = (amountBaht / 10) * 50;
        const user = await User.findOneAndUpdate({ name }, { $inc: { fbCoins: addedCoins } }, { new: true });
        res.json({ success: true, message: `เติมเงินสำเร็จ! ได้รับ ${addedCoins} เหรียญ`, fbCoins: user.fbCoins });
    } catch (err) {
        res.json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

app.post('/api/withdraw', async (req, res) => {
    try {
        const { name, fullName, bankName, accountNumber, amountCoins } = req.body;
        const user = await User.findOne({ name });
        if (!user || user.fbCoins < amountCoins) return res.json({ success: false, message: 'เหรียญไม่พอถอน' });
        user.fbCoins -= amountCoins;
        user.bankDetails = { fullName, bankName, accountNumber };
        await user.save();
        res.json({ success: true, message: 'ถอนเงินสำเร็จ', fbCoins: user.fbCoins });
    } catch (err) {
        res.json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

app.post('/api/send-gift', async (req, res) => {
    try {
        const { senderName, receiverName, coinAmount } = req.body;
        const sender = await User.findOne({ name: senderName });
        if (!sender || sender.fbCoins < coinAmount) return res.json({ success: false, message: 'เหรียญไม่พอ' });
        sender.fbCoins -= coinAmount;
        await sender.save();
        const receiver = await User.findOneAndUpdate({ name: receiverName }, { $inc: { fbCoins: coinAmount } }, { new: true });
        res.json({ success: true, senderCoins: sender.fbCoins });
    } catch (err) {
        res.json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// API ติดตาม / เลิกติดตาม (Follow / Unfollow)
app.post('/api/follow', async (req, res) => {
    try {
        const { userName, targetUser } = req.body;
        if (userName === targetUser) return res.json({ success: false, message: 'ติดตามตัวเองไม่ได้' });

        const user = await User.findOne({ name: userName });
        const target = await User.findOne({ name: targetUser });

        if (!user || !target) return res.json({ success: false, message: 'ไม่พบผู้ใช้' });

        const isFollowing = user.following.includes(targetUser);
        if (isFollowing) {
            user.following.pull(targetUser);
            target.followers.pull(userName);
        } else {
            user.following.push(targetUser);
            target.followers.push(userName);
        }
        await user.save();
        await target.save();
        res.json({ success: true, isFollowing: !isFollowing });
    } catch (err) {
        res.json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

app.post('/api/posts', async (req, res) => {
    try {
        const { author, content } = req.body;
        const newPost = new Post({ author, content });
        await newPost.save();
        res.json({ success: true, post: newPost });
    } catch (err) {
        res.json({ success: false, message: 'โพสต์ไม่สำเร็จ' });
    }
});

app.get('/api/posts', async (req, res) => {
    try {
        const posts = await Post.find().sort({ createdAt: -1 });
        res.json(posts);
    } catch (err) { res.json([]); }
});

app.get('/api/stats', async (req, res) => {
    try {
        const count = await User.countDocuments();
        res.json({ totalMembers: count });
    } catch (err) { res.json({ totalMembers: 0 }); }
});

app.get('/api/users', async (req, res) => {
    try {
        const users = await User.find({}, 'name fbCoins following followers');
        res.json(users);
    } catch (err) { res.json([]); }
});

app.get('/api/private-messages/:user1/:user2', async (req, res) => {
    try {
        const { user1, user2 } = req.params;
        const messages = await PrivateMessage.find({
            $or: [
                { sender: user1, receiver: user2 },
                { sender: user2, receiver: user1 }
            ]
        }).sort({ createdAt: 1 });
        res.json(messages);
    } catch (err) { res.json([]); }
});

// Socket.io & WebRTC Signaling สำหรับไลฟ์สดสตรีมมิ่ง
const onlineUsers = new Map();
const activeLiveStreams = new Map();

io.on('connection', (socket) => {
    socket.on('user_online', (username) => {
        if (username) {
            onlineUsers.set(username, socket.id);
            io.emit('online_users_list', Array.from(onlineUsers.keys()));
        }
    });

    socket.on('start_live', (username) => {
        activeLiveStreams.set(username, socket.id);
        io.emit('live_streams_update', Array.from(activeLiveStreams.keys()));
    });

    socket.on('end_live', (username) => {
        activeLiveStreams.delete(username);
        io.emit('live_streams_update', Array.from(activeLiveStreams.keys()));
    });

    // WebRTC Signaling สำหรับเชื่อมต่อภาพไลฟ์สดระหว่างคนไลฟ์กับคนดู
    socket.on('join_live_room', (data) => {
        const broadcasterSocketId = activeLiveStreams.get(data.broadcaster);
        if (broadcasterSocketId) {
            io.to(broadcasterSocketId).emit('request_offer', { viewer: socket.id });
        }
    });

    socket.on('offer', (data) => {
        io.to(data.to).emit('offer', { offer: data.offer, from: socket.id });
    });

    socket.on('answer', (data) => {
        io.to(data.to).emit('answer', { answer: data.answer, from: socket.id });
    });

    socket.on('ice-candidate', (data) => {
        io.to(data.to).emit('ice-candidate', { candidate: data.candidate, from: socket.id });
    });

    socket.on('send_private_message', async (data) => {
        const newMessage = new PrivateMessage({ sender: data.sender, receiver: data.receiver, message: data.message });
        await newMessage.save();
        const receiverSocketId = onlineUsers.get(data.receiver);
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('receive_private_message', newMessage);
        }
        socket.emit('receive_private_message', newMessage);
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
        io.emit('live_streams_update', Array.from(activeLiveStreams.keys()));
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});