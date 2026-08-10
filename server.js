const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:1234@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Connected Successfully!'))
    .catch(err => console.log('MongoDB Connection Error:', err));

// User Schema - เพิ่มข้อมูลบัญชีธนาคารและการถอนเงิน
const userSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    email: String,
    phone: String,
    securityQuestion: String,
    securityAnswer: String,
    profileImage: { type: String, default: '' },
    statusMessage: { type: String, default: '' },
    fbCoins: { type: Number, default: 100 }, // แจกเหรียญเริ่มต้น 100 เหรียญสำหรับทดลองส่งดอกไม้
    bankDetails: {
        fullName: { type: String, default: '' },
        bankName: { type: String, default: '' },
        accountNumber: { type: String, default: '' },
        phone: { type: String, default: '' }
    },
    friends: [{ type: String }],
    following: [{ type: String }],
    followers: [{ type: String }]
});

const User = mongoose.model('User', userSchema);

// Schema สำหรับโพสต์ / มีเดีย
const postSchema = new mongoose.Schema({
    author: { type: String, required: true },
    content: { type: String, required: true },
    mediaUrl: { type: String, default: '' },
    likes: [{ type: String }],
    flowersCount: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});
const Post = mongoose.model('Post', postSchema);

const privateMessageSchema = new mongoose.Schema({
    sender: { type: String, required: true },
    receiver: { type: String, required: true },
    message: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
const PrivateMessage = mongoose.model('PrivateMessage', privateMessageSchema);

// API สมัครสมาชิก
app.post('/api/register', async (req, res) => {
    try {
        const { name, password, email, phone, securityQuestion, securityAnswer } = req.body;
        const existingUser = await User.findOne({ name });
        if (existingUser) {
            return res.json({ success: false, message: 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว' });
        }
        const newUser = new User({ name, password, email, phone, securityQuestion, securityAnswer });
        await newUser.save();
        res.json({ success: true, message: 'ลงทะเบียนสำเร็จ' });
    } catch (err) {
        res.json({ success: false, message: 'เกิดข้อผิดพลาดในระบบฐานข้อมูล' });
    }
});

// API เข้าสู่ระบบ
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
        res.json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// API เติมเหรียญ FB ผ่าน QR Code
app.post('/api/topup', async (req, res) => {
    try {
        const { name, amountBaht } = req.body;
        const addedCoins = (amountBaht / 10) * 50; // เรท 10 บาท = 50 เหรียญ
        const user = await User.findOneAndUpdate(
            { name },
            { $inc: { fbCoins: addedCoins } },
            { new: true }
        );
        if (user) {
            res.json({ success: true, message: `เติมเงินสำเร็จ! ได้รับ ${addedCoins} เหรียญ FB`, fbCoins: user.fbCoins });
        } else {
            res.json({ success: false, message: 'ไม่พบชื่อผู้ใช้งาน' });
        }
    } catch (err) {
        res.json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// API บันทึกข้อมูลบัญชีธนาคารและการถอนเงิน
app.post('/api/withdraw', async (req, res) => {
    try {
        const { name, fullName, bankName, accountNumber, phone, amountCoins } = req.body;
        const user = await User.findOne({ name });
        if (!user) return res.json({ success: false, message: 'ไม่พบผู้ใช้งาน' });

        if (user.fbCoins < amountCoins) {
            return res.json({ success: false, message: 'เหรียญในกระเป๋าไม่เพียงพอสำหรับการถอน' });
        }

        // คำนวณเงินบาท (เช่น 50 เหรียญ = 10 บาท)
        const amountBaht = (amountCoins / 50) * 10;

        // หักเหรียญและอัปเดตข้อมูลบัญชี
        user.fbCoins -= amountCoins;
        user.bankDetails = { fullName, bankName, accountNumber, phone };
        await user.save();

        res.json({ 
            success: true, 
            message: `ถอนเงินสำเร็จ ${amountBaht} บาท โอนเข้าบัญชี ${bankName} (${accountNumber}) เรียบร้อยแล้ว`, 
            fbCoins: user.fbCoins 
        });
    } catch (err) {
        res.json({ success: false, message: 'เกิดข้อผิดพลาดในการถอนเงิน' });
    }
});

// API ส่งดอกไม้ / ของขวัญ (หักเหรียญผู้ส่ง เพิ่มเหรียญให้ผู้รับ)
app.post('/api/send-gift', async (req, res) => {
    try {
        const { senderName, receiverName, coinAmount } = req.body;
        if (senderName === receiverName) {
            return res.json({ success: false, message: 'ไม่สามารถส่งของขวัญให้ตัวเองได้' });
        }

        const sender = await User.findOne({ name: senderName });
        if (!sender || sender.fbCoins < coinAmount) {
            return res.json({ success: false, message: 'เหรียญ FB ของคุณไม่เพียงพอ' });
        }

        sender.fbCoins -= coinAmount;
        await sender.save();

        const receiver = await User.findOneAndUpdate(
            { name: receiverName },
            { $inc: { fbCoins: coinAmount } },
            { new: true }
        );

        res.json({ success: true, senderCoins: sender.fbCoins, receiverCoins: receiver ? receiver.fbCoins : 0 });
    } catch (err) {
        res.json({ success: false, message: 'เกิดข้อผิดพลาดในการส่งของขวัญ' });
    }
});

// API โพสต์ฟีดสถานะ
app.post('/api/posts', async (req, res) => {
    try {
        const { author, content, mediaUrl } = req.body;
        const newPost = new Post({ author, content, mediaUrl });
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
    } catch (err) {
        res.json([]);
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
        const users = await User.find({}, 'name profileImage statusMessage fbCoins bankDetails friends following followers');
        res.json(users);
    } catch (err) {
        res.json([]);
    }
});

// Real-time Socket.io สำหรับแชทและไลฟ์สด
const onlineUsers = new Map();
const activeLiveStreams = new Map(); // เก็บสถานะไลฟ์สด

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('user_online', (username) => {
        if (username) {
            onlineUsers.set(username, socket.id);
            io.emit('online_users_list', Array.from(onlineUsers.keys()));
        }
    });

    // ระบบไลฟ์สด
    socket.on('start_live', (username) => {
        activeLiveStreams.set(username, socket.id);
        io.emit('live_streams_update', Array.from(activeLiveStreams.keys()));
    });

    socket.on('end_live', (username) => {
        activeLiveStreams.delete(username);
        io.emit('live_streams_update', Array.from(activeLiveStreams.keys()));
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