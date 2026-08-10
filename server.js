const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// 1. เชื่อมต่อ MongoDB Atlas
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:1234@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Connected Successfully!'))
    .catch(err => console.log('MongoDB Connection Error:', err));

// 2. โครงสร้างข้อมูลสมาชิก (User Schema) - เพิ่ม fbCoins สำหรับระบบเหรียญ
const userSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    email: String,
    phone: String,
    securityQuestion: String,
    securityAnswer: String,
    profileImage: { type: String, default: '' },
    statusMessage: { type: String, default: '' },
    fbCoins: { type: Number, default: 50 }, // แจกเหรียญทดลองใช้เริ่มต้น 50 เหรียญ
    friends: [{ type: String }],
    following: [{ type: String }],
    followers: [{ type: String }]
});

const User = mongoose.model('User', userSchema);

// Schema สำหรับแชทส่วนตัว
const privateMessageSchema = new mongoose.Schema({
    sender: { type: String, required: true },
    receiver: { type: String, required: true },
    message: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
const PrivateMessage = mongoose.model('PrivateMessage', privateMessageSchema);

// 3. API สำหรับสมัครสมาชิก
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

// 4. API สำหรับเข้าสู่ระบบ
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

// API สำหรับเติมเหรียญ FB (ฟูบะ) ผ่าน QR Code
app.post('/api/topup', async (req, res) => {
    try {
        const { name, amountBaht } = req.body;
        // เรทตัวอย่าง: 10 บาท = 50 เหรียญ FB
        const addedCoins = (amountBaht / 10) * 50; 

        const user = await User.findOneAndUpdate(
            { name },
            { $inc: { fbCoins: addedCoins } },
            { new: true }
        );

        if (user) {
            res.json({ success: true, message: `เติมเงินสำเร็จ! ได้รับ ${addedCoins} เหรียญ FB`, fbCoins: user.fbCoins });
        } else {
            res.json({ success: false, message: 'ไม่พบชื่อผู้ใช้งานในระบบ' });
        }
    } catch (err) {
        res.json({ success: false, message: 'เกิดข้อผิดพลาดในการเติมเหรียญ' });
    }
});

// 5. API สำหรับกู้คืนรหัสผ่าน
app.post('/api/forgot', async (req, res) => {
    try {
        const { name, securityAnswer } = req.body;
        const user = await User.findOne({ name, securityAnswer });
        if (user) {
            res.json({ success: true, password: user.password });
        } else {
            res.json({ success: false, message: 'ชื่อผู้ใช้หรือคำตอบช่วยจำไม่ถูกต้อง' });
        }
    } catch (err) {
        res.json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// 6. API ดึงจำนวนสมาชิกทั้งหมด
app.get('/api/stats', async (req, res) => {
    try {
        const count = await User.countDocuments();
        res.json({ totalMembers: count });
    } catch (err) {
        res.json({ totalMembers: 0 });
    }
});

// 7. API ดึงรายชื่อสมาชิกทั้งหมด
app.get('/api/users', async (req, res) => {
    try {
        const users = await User.find({}, 'name profileImage statusMessage fbCoins friends following followers');
        res.json(users);
    } catch (err) {
        res.json([]);
    }
});

// 8. API อัปเดตโปรไฟล์
app.post('/api/update-profile', async (req, res) => {
    try {
        const { name, profileImage, statusMessage } = req.body;
        const updatedUser = await User.findOneAndUpdate(
            { name },
            { profileImage, statusMessage },
            { new: true }
        );
        if (updatedUser) {
            res.json({ success: true, message: 'อัปเดตโปรไฟล์สำเร็จ', user: updatedUser });
        } else {
            res.json({ success: false, message: 'ไม่พบผู้ใช้งาน' });
        }
    } catch (err) {
        res.json({ success: false, message: 'เกิดข้อผิดพลาดในการอัปเดต' });
    }
});

// 9. API เพิ่มเพื่อนและติดตาม
app.post('/api/follow', async (req, res) => {
    try {
        const { currentUserName, targetUserName } = req.body;
        await User.findOneAndUpdate({ name: currentUserName }, { $addToSet: { following: targetUserName } });
        await User.findOneAndUpdate({ name: targetUserName }, { $addToSet: { followers: currentUserName } });
        res.json({ success: true, message: 'ติดตามสำเร็จ' });
    } catch (err) {
        res.json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

app.post('/api/add-friend', async (req, res) => {
    try {
        const { currentUserName, targetUserName } = req.body;
        await User.findOneAndUpdate({ name: currentUserName }, { $addToSet: { friends: targetUserName } });
        await User.findOneAndUpdate({ name: targetUserName }, { $addToSet: { friends: currentUserName } });
        res.json({ success: true, message: 'เป็นเพื่อนกันเรียบร้อย สามารถแชทได้แล้ว' });
    } catch (err) {
        res.json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// 10. API ดึงประวัติแชทส่วนตัว
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

// 11. ระบบ Real-time Socket.io
const onlineUsers = new Map();

io.on('connection', (socket) => {
    console.log('มีผู้ใช้งานเชื่อมต่อ Socket:', socket.id);

    socket.on('user_online', (username) => {
        if (username) {
            onlineUsers.set(username, socket.id);
            io.emit('online_users_list', Array.from(onlineUsers.keys()));
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
            console.error("Private message error:", err);
        }
    });

    // ระบบ WebRTC วิดีโอคอล
    socket.on('call_user', (data) => {
        const targetSocketId = onlineUsers.get(data.toUser);
        if (targetSocketId) {
            io.to(targetSocketId).emit('incoming_call', data);
        }
    });

    socket.on('answer_call', (data) => {
        const targetSocketId = onlineUsers.get(data.toUser);
        if (targetSocketId) {
            io.to(targetSocketId).emit('call_answered', data);
        }
    });

    socket.on('ice_candidate', (data) => {
        const targetSocketId = onlineUsers.get(data.toUser);
        if (targetSocketId) {
            io.to(targetSocketId).emit('ice_candidate', data);
        }
    });

    socket.on('end_call', (data) => {
        const targetSocketId = onlineUsers.get(data.toUser);
        if (targetSocketId) {
            io.to(targetSocketId).emit('call_ended', data);
        }
    });

    socket.on('disconnect', () => {
        for (let [username, sId] of onlineUsers.entries()) {
            if (sId === socket.id) {
                onlineUsers.delete(username);
                break;
            }
        }
        io.emit('online_users_list', Array.from(onlineUsers.keys()));
        console.log('ผู้ใช้งานตัดการเชื่อมต่อ Socket:', socket.id);
    });
});

const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});