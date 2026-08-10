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
app.use(express.json({ limit: '10mb' })); // รองรับการส่งรูปภาพขนาดใหญ่ขึ้น
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// 1. เชื่อมต่อ MongoDB Atlas
const MONGO_URI = process.env.MONGO_URI || "ใส่ลิงก์ MongoDB ของพี่ดิมตรงนี้ หรือใช้ Environment Variable บน Render";

mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Connected Successfully!'))
    .catch(err => console.log('MongoDB Connection Error:', err));

// 2. โครงสร้างข้อมูลสมาชิก (User Schema อัปเกรดรองรับโปรไฟล์ เพื่อน และติดตาม)
const userSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    email: String,
    phone: String,
    securityQuestion: String,
    securityAnswer: String,
    profileImage: { type: String, default: '' }, // รูปโปรไฟล์
    statusMessage: { type: String, default: '' }, // สถานะล่าสุด
    friends: [{ type: String }], // รายชื่อเพื่อน (เก็บเป็นชื่อหรือ ID)
    following: [{ type: String }], // กำลังติดตาม
    followers: [{ type: String }] // ผู้ติดตาม
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

// 7. API ดึงรายชื่อสมาชิกทั้งหมด (พร้อมข้อมูลโปรไฟล์และสถานะ)
app.get('/api/users', async (req, res) => {
    try {
        const users = await User.find({}, 'name profileImage statusMessage friends following followers');
        res.json(users);
    } catch (err) {
        res.json([]);
    }
});

// 8. API อัปเดตโปรไฟล์ (รูปภาพ และสถานะ)
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

// 11. ระบบ Real-time Socket.io (รองรับแชทสาธารณะ แชทส่วนตัว และสัญญาณวิดีโอคอล)
const onlineUsers = new Map(); // ติดตามสถานะออนไลน์ (ชื่อผู้ใช้ -> socket.id)

io.on('connection', (socket) => {
    console.log('มีผู้ใช้งานเชื่อมต่อ Socket:', socket.id);

    // บันทึกสถานะเมื่อผู้ใช้ล็อกอินเข้ามา
    socket.on('user_online', (username) => {
        if (username) {
            onlineUsers.set(username, socket.id);
            io.emit('online_users_list', Array.from(onlineUsers.keys()));
        }
    });

    // แชทสาธารณะ (รองรับข้อความ รูปภาพ และกดไลค์หัวใจ)
    socket.on('chat-message', (data) => {
        io.emit('chat-message', data);
    });

    socket.on('like-public-message', (data) => {
        io.emit('like-public-message', data);
    });

    // แชทส่วนตัวแบบเรียลไทม์
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
            socket.emit('receive_private_message', newMessage); // ส่งกลับหาคนส่งด้วยเพื่อให้ขึ้นหน้าจอทันที
        } catch (err) {
            console.error("Private message error:", err);
        }
    });

    // ระบบวิดีโอคอล / โทร (WebRTC Signaling พร้อมเปิด-ปิดกล้อง)
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


// 12. API สำหรับรับและบันทึกโค้ดอัตโนมัติจากหน้าตั้งค่า
const fs = require('fs');

app.post('/api/inject-code', (req, res) => {
    try {
        const { target, code } = req.body;
        
        if (!code || !code.trim()) {
            return res.json({ success: false, message: 'ไม่มีข้อมูลโค้ดที่ส่งมา' });
        }

        // กำหนดไฟล์เป้าหมายที่จะบันทึก
        // ถ้า target เป็น 'server' จะบันทึกทับ server.js (หรือไฟล์ปัจจุบัน) ถ้าเป็น 'index' จะบันทึกไฟล์ index.html
        let targetFilePath = target === 'server' ? __filename : path.join(__dirname, 'index.html');

        // ตัวเลือก: เขียนทับ หรือ จะใช้วิธีต่อท้ายไฟล์ (Append) 
        // ในที่นี้เลือกใช้วิธีบันทึกอัปเดต หรือเขียนต่อท้ายตามความเหมาะสมของพี่ดิมครับ
        fs.appendFile(targetFilePath, '\n\n/* --- โค้ดที่เพิ่มผ่านระบบอัตโนมัติ --- */\n' + code, 'utf8', (err) => {
            if (err) {
                console.error("Inject code error:", err);
                return res.json({ success: false, message: 'ไม่สามารถบันทึกไฟล์ได้: ' + err.message });
            }
            res.json({ success: true, message: 'บันทึกโค้ดลงไฟล์เรียบร้อยแล้ว' });
        });

    } catch (err) {
        console.error("Server error:", err);
        res.json({ success: false, message: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
    }
});
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});