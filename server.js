const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path'); // 1. เรียกใช้งาน path โมดูลสำหรับจัดการเส้นทางไฟล์

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

let users = []; 
let privateMessages = []; 
let totalViews = 1;
let onlineUsers = new Set();

// 2. เพิ่ม Route สำหรับเสิร์ฟไฟล์ index.html เมื่อเปิดหน้าแรก
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/stats', (req, res) => {
    res.json({
        totalMembers: users.length,
        totalViews: totalViews
    });
});

app.get('/api/users', (req, res) => {
    const safeUsers = users.map(u => ({
        name: u.name,
        profileImage: u.profileImage || '',
        statusMessage: u.statusMessage || ''
    }));
    res.json(safeUsers);
});

app.post('/api/register', (req, res) => {
    const { name, password, email, phone, securityQuestion, securityAnswer } = req.body;
    if (!name || !password) {
        return res.json({ success: false, message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
    }
    const existing = users.find(u => u.name === name);
    if (existing) {
        return res.json({ success: false, message: 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว' });
    }

    users.push({
        name,
        password,
        email: email || '',
        phone: phone || '',
        securityQuestion: securityQuestion || '',
        securityAnswer: securityAnswer || '',
        profileImage: '',
        statusMessage: ''
    });
    res.json({ success: true, message: 'สมัครสมาชิกสำเร็จ' });
});

app.post('/api/login', (req, res) => {
    const { name, password } = req.body;
    const user = users.find(u => u.name === name && u.password === password);
    if (user) {
        res.json({ success: true, message: 'เข้าสู่ระบบสำเร็จ', user: { name: user.name } });
    } else {
        res.json({ success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }
});

app.post('/api/forgot', (req, res) => {
    const { name, securityAnswer } = req.body;
    const user = users.find(u => u.name === name && u.securityAnswer === securityAnswer);
    if (user) {
        res.json({ success: true, password: user.password });
    } else {
        res.json({ success: false, message: 'ชื่อผู้ใช้หรือคำตอบช่วยจำไม่ถูกต้อง' });
    }
});

app.post('/api/update-profile', (req, res) => {
    const { name, profileImage, statusMessage } = req.body;
    const user = users.find(u => u.name === name);
    if (user) {
        if (profileImage) user.profileImage = profileImage;
        if (statusMessage !== undefined) user.statusMessage = statusMessage;
        res.json({ success: true, user });
    } else {
        res.json({ success: false, message: 'ไม่พบผู้ใช้งาน' });
    }
});

app.get('/api/private-messages/:user1/:user2', (req, res) => {
    const { user1, user2 } = req.params;
    const filtered = privateMessages.filter(m => 
        (m.sender === user1 && m.receiver === user2) || 
        (m.sender === user2 && m.receiver === user1)
    );
    res.json(filtered);
});

io.on('connection', (socket) => {
    totalViews++;

    socket.on('user_online', (username) => {
        socket.username = username;
        onlineUsers.add(username);
        io.emit('online_users_list', Array.from(onlineUsers));
    });

    socket.on('chat-message', (data) => {
        io.emit('chat-message', data);
    });

    socket.on('send_private_message', (data) => {
        privateMessages.push({
            sender: data.sender,
            receiver: data.receiver,
            message: data.message,
            timestamp: new Date()
        });
        io.emit('receive_private_message', data);
    });

    // ระบบวิดีโอคอลและ WebRTC Signaling
    socket.on('call_user', (data) => {
        for (let [id, sock] of io.sockets.sockets) {
            if (sock.username === data.toUser) {
                sock.emit('incoming_call', data);
                break;
            }
        }
    });

    socket.on('video_offer', (data) => {
        for (let [id, sock] of io.sockets.sockets) {
            if (sock.username === data.toUser) {
                sock.emit('video_offer', data);
                break;
            }
        }
    });

    socket.on('video_answer', (data) => {
        for (let [id, sock] of io.sockets.sockets) {
            if (sock.username === data.toUser) {
                sock.emit('video_answer', data);
                break;
            }
        }
    });

    socket.on('ice_candidate', (data) => {
        for (let [id, sock] of io.sockets.sockets) {
            if (sock.username === data.toUser) {
                sock.emit('ice_candidate', data);
                break;
            }
        }
    });

    socket.on('end_call', (data) => {
        for (let [id, sock] of io.sockets.sockets) {
            if (sock.username === data.toUser) {
                sock.emit('call_ended');
                break;
            }
        }
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            onlineUsers.delete(socket.username);
            io.emit('online_users_list', Array.from(onlineUsers));
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});