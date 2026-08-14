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
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
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
    mediaUrl: { type: String, default: '' },
    mediaType: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});
const PrivateMessage = mongoose.model('PrivateMessage', privateMessageSchema);

const postSchema = new mongoose.Schema({
    author: String,
    text: String,
    createdAt: { type: Date, default: Date.now }
});
const Post = mongoose.model('Post', postSchema);

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

app.get('/api/users', async (req, res) => {
    try {
        const users = await User.find({}, 'name statusMessage fbCoins friends following followers');
        res.json(users);
    } catch (err) {
        res.json([]);
    }
});

app.get('/api/user-info', async (req, res) => {
    try {
        const user = await User.findOne({ name: req.query.name });
        if (user) res.json({ success: true, user });
        else res.json({ success: false });
    } catch (err) {
        res.json({ success: false });
    }
});

// API ระบบเพิ่มเพื่อน
app.post('/api/add-friend', async (req, res) => {
    try {
        const { name, targetUser } = req.body;
        await User.updateOne({ name }, { $addToSet: { friends: targetUser } });
        await User.updateOne({ name: targetUser }, { $addToSet: { friends: name } });
        res.json({ success: true, message: `เพิ่มเพื่อนกับ ${targetUser} สำเร็จ!` });
    } catch (err) {
        res.json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// API ระบบติดตาม
app.post('/api/follow', async (req, res) => {
    try {
        const { name, targetUser } = req.body;
        await User.updateOne({ name }, { $addToSet: { following: targetUser } });
        await User.updateOne({ name: targetUser }, { $addToSet: { followers: name } });
        res.json({ success: true, message: `ติดตาม ${targetUser} สำเร็จ!` });
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

app.get('/api/posts', async (req, res) => {
    try {
        const posts = await Post.find().sort({ createdAt: -1 }).limit(20);
        res.json(posts);
    } catch (err) {
        res.json([]);
    }
});

app.post('/api/posts', async (req, res) => {
    try {
        const { author, text } = req.body;
        await new Post({ author, text }).save();
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false });
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

const onlineUsers = new Map();

io.on('connection', (socket) => {
    socket.on('user_online', (username) => {
        if (username) {
            onlineUsers.set(username, socket.id);
            io.emit('online_users_list', Array.from(onlineUsers.keys()));
        }
    });

    socket.on('send_private_message', async (data) => {
        try {
            const newMessage = new PrivateMessage({
                sender: data.sender,
                receiver: data.receiver,
                message: data.message,
                mediaUrl: data.mediaUrl || '',
                mediaType: data.mediaType || ''
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
                break;
            }
        }
        io.emit('online_users_list', Array.from(onlineUsers.keys()));
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});