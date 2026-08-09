const express = require('express');
const fs = require('fs');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;
const DB_FILE = './database.json';

app.use(express.json());
app.use(express.text());
app.use(cors());
app.use('/uploads', express.static('uploads'));

// ✨ เพิ่มคำสั่งนี้เพื่อให้ระบบเปิดหน้า index.html ออัตโนมัติ
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

function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = { members: [], songs: [], totalViews: 0 };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    }
    const data = fs.readFileSync(DB_FILE);
    const db = JSON.parse(data);
    if (!db.songs) db.songs = [];
    if (!db.members) db.members = [];
    if (db.totalViews === undefined) db.totalViews = 0;
    return db;
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

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

app.post('/api/view-update', (req, res) => {
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

    const db = loadDB();
    if (action === 'join') {
        currentViewers++;
        db.totalViews += 1;
    } else if (action === 'leave' && currentViewers > 0) {
        currentViewers--;
    }
    saveDB(db);
    res.json({ success: true, currentViewers, totalViews: db.totalViews });
});

app.post('/api/register', (req, res) => {
    const { name, password, email, phone, securityQuestion, securityAnswer } = req.body;
    if (!name || !password || !email || !phone) {
        return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
    }
    const db = loadDB();
    if (db.members.find(m => m.email === email)) {
        return res.status(400).json({ success: false, message: 'อีเมลนี้ถูกใช้งานแล้ว' });
    }
    if (db.members.find(m => m.name === name)) {
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
    
    db.members.push(newMember);
    saveDB(db);
    res.json({ success: true, message: 'ลงทะเบียนสำเร็จ!', data: newMember, totalMembers: db.members.length });
});

app.post('/api/login', (req, res) => {
    const { name, password } = req.body;
    if (!name || !password) {
        return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
    }
    const db = loadDB();
    const user = db.members.find(m => m.name === name && m.password === password);
    if (user) {
        res.json({ success: true, message: 'เข้าสู่ระบบสำเร็จ', user: { name: user.name, email: user.email } });
    } else {
        res.status(401).json({ success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }
});

app.post('/api/forgot-password', (req, res) => {
    const { name, securityAnswer } = req.body;
    if (!name || !securityAnswer) {
        return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อผู้ใช้และคำตอบ' });
    }
    const db = loadDB();
    const user = db.members.find(m => m.name === name && m.securityAnswer === securityAnswer);
    if (user) {
        res.json({ success: true, message: 'กู้คืนรหัสผ่านสำเร็จ', password: user.password });
    } else {
        res.status(401).json({ success: false, message: 'ชื่อผู้ใช้หรือคำตอบไม่ถูกต้อง' });
    }
});

app.get('/api/members', (req, res) => {
    const db = loadDB();
    const publicMembers = db.members.map(m => ({ id: m.id, name: m.name, email: m.email, avatar: m.avatar }));
    res.json({ success: true, members: publicMembers });
});

app.post('/api/upload-song', upload.single('song'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'กรุณาเลือกไฟล์ MP3 หรือ MP4' });
        }
        const db = loadDB();
        const titleText = (req.body && req.body.title) ? req.body.title : req.file.originalname;

        const newMedia = {
            id: Date.now(),
            title: titleText,
            url: `https://chatpidim.onrender.com/uploads/${req.file.filename}`
        };
        db.songs.push(newMedia);
        saveDB(db);
        res.json({ success: true, message: 'อัปโหลดสำเร็จ', song: newMedia });
    } catch (err) {
        console.error("Upload Error Details:", err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์: ' + err.message });
    }
});

app.get('/api/songs', (req, res) => {
    const db = loadDB();
    res.json({ success: true, songs: db.songs });
});

app.get('/api/stats', (req, res) => {
    const db = loadDB();
    res.json({
        success: true,
        currentViewers: currentViewers,
        totalMembers: db.members.length,
        totalViews: db.totalViews
    });
});

// เส้นทางสำรองสำหรับหน้าแรกกรณีเรียกผ่าน URL ตรง
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

server.listen(PORT, () => {
    console.log(`Backend Server is running with Real-time Chat on http://localhost:${PORT}`);
});