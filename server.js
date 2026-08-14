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
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static(path.join(__dirname)));

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:1234@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority";
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Connected Successfully!'))
    .catch(err => console.log('MongoDB Connection Error:', err));

const userSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    fbCoins: { type: Number, default: 100 },
    friends: [String]
});
const User = mongoose.model('User', userSchema);

const postSchema = new mongoose.Schema({
    author: String,
    text: String,
    mediaUrl: String,
    mediaType: String,
    createdAt: { type: Date, default: Date.now }
});
const Post = mongoose.model('Post', postSchema);

const privateMessageSchema = new mongoose.Schema({
    sender: String,
    receiver: String,
    message: String,
    createdAt: { type: Date, default: Date.now }
});
const PrivateMessage = mongoose.model('PrivateMessage', privateMessageSchema);

app.post('/api/login', async (req, res) => {
    try {
        const { name, password } = req.body;
        let user = await User.findOne({ name, password });
        if (!user) {
            user = new User({ name, password, fbCoins: 100 });
            await user.save();
        }
        res.json({ success: true, message: 'เข้าสู่ระบบสำเร็จ', user });
    } catch (err) {
        res.json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

app.get('/api/users', async (req, res) => {
    try {
        const users = await User.find({}, 'name fbCoins friends');
        res.json(users);
    } catch (err) {
        res.json([]);
    }
});

app.post('/api/topup', async (req, res) => {
    try {
        const { name, coins } = req.body;
        await User.updateOne({ name }, { $inc: { fbCoins: coins } });
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false });
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
        const { author, text, mediaUrl, mediaType } = req.body;
        await new Post({ author, text, mediaUrl, mediaType }).save();
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false });
    }
});

app.post('/api/support-author', async (req, res) => {
    try {
        const { sender, receiver, coins } = req.body;
        const senderUser = await User.findOne({ name: sender });
        if (!senderUser || senderUser.fbCoins < coins) {
            return res.json({ success: false, message: 'เหรียญของคุณไม่เพียงพอสำหรับการสนับสนุน' });
        }
        await User.updateOne({ name: sender }, { $inc: { fbCoins: -coins } });
        await User.updateOne({ name: receiver }, { $inc: { fbCoins: coins } });
        res.json({ success: true, message: `สนับสนุน ${receiver} สำเร็จ! (${coins} เหรียญ)` });
    } catch (err) {
        res.json({ success: false, message: 'เกิดข้อผิดพลาดในการทำรายการ' });
    }
});

app.post('/api/add-friend', async (req, res) => {
    try {
        const { user, friend } = req.body;
        await User.updateOne({ name: user }, { $addToSet: { friends: friend } });
        res.json({ success: true, message: `เพิ่มเพื่อน ${friend} เรียบร้อยแล้ว` });
    } catch (err) {
        res.json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

app.get('/api/private-messages', async (req, res) => {
    try {
        const { user1, user2 } = req.query;
        const messages = await PrivateMessage.find({
            $or: [
                { sender: user1, receiver: user2 },
                { sender: user2, receiver: user1 }
            ]
        }).sort({ createdAt: 1 });
        res.json(messages);
    } catch (err) {
        res.json([]);
    }
});

io.on('connection', (socket) => {
    socket.on('public_message', (data) => {
        io.emit('receive_public_message', data);
    });

    socket.on('send_private_message', async (data) => {
        const { sender, receiver, message } = data;
        await new PrivateMessage({ sender, receiver, message }).save();
        io.emit('receive_private_message', data);
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});