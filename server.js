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
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// 1. เชื่อมต่อ MongoDB Atlas (เปลี่ยนลิงก์เชื่อมต่อฐานข้อมูลของคุณตรงนี้ถ้าจำเป็น)
const MONGO_URI = process.env.MONGO_URI || "ใส่ลิงก์ MongoDB ของพี่ดิมตรงนี้ หรือใช้ Environment Variable บน Render";

mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Connected Successfully!'))
    .catch(err => console.log('MongoDB Connection Error:', err));

// 2. กำหนดโครงสร้างข้อมูลสมาชิก (User Schema)
const userSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    email: String,
    phone: String,
    securityQuestion: String,
    securityAnswer: String
});

const User = mongoose.model('User', userSchema);

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
            res.json({ success: true, message: 'เข้าสู่ระบบสำเร็จ' });
        } else {
            res.json({ success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
        }
    } catch (err) {
        res.json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
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
        const users = await User.find({}, 'name');
        res.json(users);
    } catch (err) {
        res.json([]);
    }
});

// 8. ระบบ Real-time Chat ผ่าน Socket.io
io.on('connection', (socket) => {
    console.log('มีผู้ใช้งานเชื่อมต่อ Socket:', socket.id);

    socket.on('chat-message', (data) => {
        io.emit('chat-message', data);
    });

    socket.on('disconnect', () => {
        console.log('ผู้ใช้งานตัดการเชื่อมต่อ Socket:', socket.id);
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});