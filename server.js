const express = require('express');
const fs = require('fs');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const { MongoClient } = require('mongodb');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

// 🔗 เชื่อมต่อ MongoDB Atlas ฐานข้อมูลกลาง (รองรับผู้ใช้งาน 10-30 คนขึ้นไป)
const uri = "mongodb+srv://piyasattapidim_db_user:y8bDKyMc5YGyPNFp@cluster0.ir24bhv.mongodb.net/?appName=Cluster0";
const client = new MongoClient(uri);

app.use(express.json());
app.use(express.text());
app.use(cors());
app.use('/uploads', express.static('uploads'));

// เปิดใช้งานหน้า index.html
app.use(express.static(path.join(__dirname)));

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './uploads';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

let currentViewers = 0;

// === Socket.io สำหรับระบบ Real-time Chat ข้ามเครื่อง ===
io.on('connection', (socket) => {
    console.log('⚡ มีผู้ใช้งานเชื่อมต่อ Socket:', socket.id);

    socket.on('send_private_message', (data) => {
        io.emit('receive_private_message', data);
    });

    socket.on('send_public_message', (data) => {
        io.emit('receive_public_message', data);
    });

    socket.on('disconnect', () => {
        console.log('❌ ผู้ใช้งานตัดการเชื่อมต่อ Socket:', socket.id);
    });
});

app.post('/api/view-update', async (req, res) => {
    let action = '';
    try {
        if (typeof req.body === 'string') {
            const parsed = JSON.parse(req.body);
            action = parsed.action;
        } else if (req.body && typeof req.body === 'object') {
            action = req.body.action;
        }
    } catch (e) {
        action = '';
    }

    try {
        await client.connect();
        const db = client.db("chatpidim_db");
        const statsCollection = db.collection("stats");
        let stats = await statsCollection.findOne({ id: "global_stats" });
        if (!stats) {
            stats = { id: "global_stats", totalViews: 0 };
            await statsCollection.insertOne(stats);
        }

        if (action === 'join') {
            currentViewers++;
            await statsCollection.updateOne({ id: "global_stats" }, { $inc: { totalViews: 1 } });
        } else if (action === 'leave' && currentViewers > 0) {
            currentViewers--;
        }
        
        const updatedStats = await statsCollection.findOne({ id: "global_stats" });
        res.json({ success: true, currentViewers, totalViews: updatedStats.totalViews });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/register', async (req, res) => {
    const { name, password, email, phone, securityQuestion, securityAnswer } = req.body;
    if (!name || !password || !email || !phone) {
        return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
    }
    try {
        await client.connect();
        const db = client.db("chatpidim_db");
        const membersCollection = db.collection("members");

        const existingEmail = await membersCollection.findOne({ email });
        if (existingEmail) {
            return res.status(400).json({ success: false, message: 'อีเมลนี้ถูกใช้งานแล้ว' });
        }
        const existingName = await membersCollection.findOne({ name });
        if (existingName) {
            return res.status(400).json({ success: false, message: 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว' });
        }

        const newMember = {
            id: Date.now(),
            name,
            password,
            email,
            phone,
            securityQuestion: securityQuestion || 'คำถามช่วยจำ',
            securityAnswer: securityAnswer || '',
            avatar: ''
        };

        await membersCollection.insertOne(newMember);
        const totalMembers = await membersCollection.countDocuments();
        res.json({ success: true, message: 'ลงทะเบียนสำเร็จ!', data: newMember, totalMembers });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/login', async (req, res) => {
    const { name, password } = req.body;
    if (!name || !password) {
        return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
    }
    try {
        await client.connect();
        const db = client.db("chatpidim_db");
        const user = await db.collection("members").findOne({ name, password });
        if (user) {
            res.json({ success: true, message: 'เข้าสู่ระบบสำเร็จ', user: { name: user.name, email: user.email } });
        } else {
            res.status(401).json({ success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/forgot-password', async (req, res) => {
    const { name, securityAnswer } = req.body;
    if (!name || !securityAnswer) {
        return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อผู้ใช้และคำตอบ' });
    }
    try {
        await client.connect();
        const db = client.db("chatpidim_db");
        const user = await db.collection("members").findOne({ name, securityAnswer });
        if (user) {
            res.json({ success: true, message: 'กู้คืนรหัสผ่านสำเร็จ', password: user.password });
        } else {
            res.status(401).json({ success: false, message: 'ชื่อผู้ใช้หรือคำตอบไม่ถูกต้อง' });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/members', async (req, res) => {
    try {
        await client.connect();
        const db = client.db("chatpidim_db");
        const members = await db.collection("members").find({}, { projection: { password: 0 } }).toArray();
        res.json({ success: true, members });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/upload-song', upload.single('song'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'กรุณาเลือกไฟล์ MP3 หรือ MP4' });
        }
        const titleText = (req.body && req.body.title) ? req.body.title : req.file.originalname;
        const newMedia = {
            id: Date.now(),
            title: titleText,
            url: `https://chatpidim.onrender.com/uploads/${req.file.filename}`
        };

        await client.connect();
        const db = client.db("chatpidim_db");
        await db.collection("songs").insertOne(newMedia);

        res.json({ success: true, message: 'อัปโหลดสำเร็จ', song: newMedia });
    } catch (err) {
        console.error("Upload Error Details:", err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์: ' + err.message });
    }
});

app.get('/api/songs', async (req, res) => {
    try {
        await client.connect();
        const db = client.db("chatpidim_db");
        const songs = await db.collection("songs").find().toArray();
        res.json({ success: true, songs });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/stats', async (req, res) => {
    try {
        await client.connect();
        const db = client.db("chatpidim_db");
        const membersCount = await db.collection("members").countDocuments();
        let stats = await db.collection("stats").findOne({ id: "global_stats" });
        const totalViews = stats ? stats.totalViews : 0;

        res.json({
            success: true,
            currentViewers: currentViewers,
            totalMembers: membersCount,
            totalViews: totalViews
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

server.listen(PORT, () => {
    console.log(`Backend Server is running with MongoDB & Real-time Chat on http://localhost:${PORT}`);
});