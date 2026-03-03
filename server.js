const express = require('express');
const path = require('path');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();

// 1. CẤU HÌNH HỆ THỐNG
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

// CHỈ ĐỊNH THƯ MỤC PUBLIC: Phục vụ toàn bộ HTML, CSS, JS, Ảnh từ đây
app.use(express.static(path.join(__dirname, 'public')));

// 2. KẾT NỐI DATABASE NEON.TECH
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Khởi tạo bảng dữ liệu (Neon PostgreSQL)
const initDB = async () => {
    try {
        const client = await pool.connect();
        // Bảng Users
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                full_name TEXT NOT NULL,
                phone TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                balance DECIMAL(15, 2) DEFAULT 0,
                role TEXT DEFAULT 'user'
            )
        `);
        // Bảng Properties
        await client.query(`
            CREATE TABLE IF NOT EXISTS properties (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                title TEXT,
                category TEXT,
                location TEXT,
                price TEXT,
                area TEXT,
                description TEXT,
                legal_status TEXT,
                images TEXT[], 
                is_vip BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        // Bảng News
        await client.query(`
            CREATE TABLE IF NOT EXISTS news (
                id SERIAL PRIMARY KEY,
                title TEXT,
                category TEXT,
                thumbnail TEXT,
                content TEXT,
                author TEXT DEFAULT 'Phạm Văn Quân',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        // Bảng Configs
        await client.query(`
            CREATE TABLE IF NOT EXISTS configs (
                id INTEGER PRIMARY KEY DEFAULT 1,
                bank TEXT,
                account_name TEXT,
                account_number TEXT
            )
        `);

        // Tài khoản GĐ mặc định
        await client.query(`
            INSERT INTO users (full_name, phone, password, balance, role)
            VALUES ('Phạm Văn Quân', '0971828236', 'quan123', 999999999, 'admin')
            ON CONFLICT (phone) DO NOTHING
        `);

        client.release();
        console.log("🐘 [Neon DB] Hệ thống đã sẵn sàng!");
    } catch (err) {
        console.error("❌ [DB Error]:", err);
    }
};
initDB();

// ==========================================
// 3. HỆ THỐNG API (GIỮ NGUYÊN LOGIC CHUẨN)
// ==========================================

// --- AUTH API ---
app.post('/api/auth/register', async (req, res) => {
    const { full_name, phone, password } = req.body;
    try {
        const result = await pool.query(
            "INSERT INTO users (full_name, phone, password) VALUES ($1, $2, $3) RETURNING id, full_name, phone, balance, role",
            [full_name, phone, password]
        );
        res.json({ success: true, user: result.rows[0] });
    } catch (err) { res.status(400).json({ message: "SĐT đã tồn tại!" }); }
});

app.post('/api/auth/login', async (req, res) => {
    const { phone, password } = req.body;
    try {
        const result = await pool.query("SELECT id, full_name, phone, balance, role FROM users WHERE phone = $1 AND password = $2", [phone, password]);
        if (result.rows.length > 0) res.json({ success: true, user: result.rows[0] });
        else res.status(401).json({ message: "Sai tài khoản hoặc mật khẩu!" });
    } catch (err) { res.status(500).json({ message: "Lỗi hệ thống" }); }
});

// --- PROPERTIES API ---
app.get('/api/properties', async (req, res) => {
    try {
        const { category, location } = req.query;
        let sql = "SELECT p.*, u.full_name, u.role FROM properties p JOIN users u ON p.user_id = u.id WHERE 1=1";
        const params = [];
        if (category) { params.push(category); sql += ` AND p.category = $${params.length}`; }
        if (location) { params.push(`%${location}%`); sql += ` AND p.location ILIKE $${params.length}`; }
        sql += " ORDER BY p.is_vip DESC, p.created_at DESC";
        const result = await pool.query(sql, params);
        res.json(result.rows);
    } catch (err) { res.json([]); }
});

app.get('/api/properties/:id', async (req, res) => {
    try {
        const result = await pool.query("SELECT p.*, u.full_name, u.role, u.phone FROM properties p JOIN users u ON p.user_id = u.id WHERE p.id = $1", [req.params.id]);
        res.json(result.rows);
    } catch (err) { res.status(404).json([]); }
});

app.post('/api/properties', async (req, res) => {
    const { user_id, title, category, location, price, area, description, legal_status, images } = req.body;
    try {
        const user = (await pool.query("SELECT balance, role FROM users WHERE id = $1", [user_id])).rows[0];
        if (user.role !== 'admin') {
            if (Number(user.balance) < 20000) return res.status(400).json({ message: "Không đủ 20.000đ" });
            await pool.query("UPDATE users SET balance = balance - 20000 WHERE id = $1", [user_id]);
        }
        const result = await pool.query(
            "INSERT INTO properties (user_id, title, category, location, price, area, description, legal_status, images) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *",
            [user_id, title, category, location, price, area, description, legal_status, images]
        );
        res.json({ success: true, property: result.rows[0] });
    } catch (err) { res.status(500).json({ message: "Lỗi đăng tin" }); }
});

app.put('/api/properties/:id/vip', async (req, res) => {
    try {
        const prop = (await pool.query("SELECT user_id FROM properties WHERE id = $1", [req.params.id])).rows[0];
        const user = (await pool.query("SELECT balance, role FROM users WHERE id = $1", [prop.user_id])).rows[0];
        if (user.role !== 'admin') {
            if (Number(user.balance) < 50000) return res.status(400).json({ message: "Không đủ 50.000đ" });
            await pool.query("UPDATE users SET balance = balance - 50000 WHERE id = $1", [prop.user_id]);
        }
        await pool.query("UPDATE properties SET is_vip = TRUE WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ message: "Lỗi nâng cấp" }); }
});

app.delete('/api/properties/:id', async (req, res) => {
    await pool.query("DELETE FROM properties WHERE id = $1", [req.params.id]);
    res.json({ success: true });
});

// --- NEWS & ADMIN API ---
app.get('/api/news', async (req, res) => {
    const result = await pool.query("SELECT * FROM news ORDER BY created_at DESC");
    res.json(result.rows);
});

app.get('/api/news/:id', async (req, res) => {
    const result = await pool.query("SELECT * FROM news WHERE id = $1", [req.params.id]);
    res.json(result.rows);
});

app.post('/api/news', async (req, res) => {
    const { title, category, thumbnail, content } = req.body;
    await pool.query("INSERT INTO news (title, category, thumbnail, content) VALUES ($1, $2, $3, $4)", [title, category, thumbnail, content]);
    res.json({ success: true });
});

app.post('/api/admin/config-bank', async (req, res) => {
    const { bank, account_name, account_number } = req.body;
    await pool.query("INSERT INTO configs (id, bank, account_name, account_number) VALUES (1, $1, $2, $3) ON CONFLICT (id) DO UPDATE SET bank=$1, account_name=$2, account_number=$3", [bank, account_name, account_number]);
    res.json({ success: true });
});

app.get('/api/config-bank', async (req, res) => {
    const result = await pool.query("SELECT * FROM configs WHERE id = 1");
    res.json(result.rows[0] || {});
});

app.post('/api/admin/topup', async (req, res) => {
    const { phone, amount } = req.body;
    const update = await pool.query("UPDATE users SET balance = balance + $1 WHERE phone = $2", [amount, phone]);
    if (update.rowCount > 0) res.json({ success: true });
    else res.status(404).json({ message: "SĐT không tồn tại" });
});

// --- WEBHOOK GIAO DỊCH TỰ ĐỘNG ---
app.post('/api/webhook/transaction', async (req, res) => {
    const { transferAmount, amountIn, content, transactionContent } = req.body;
    const amount = transferAmount || amountIn || 0;
    const msg = content || transactionContent || "";
    const match = msg.match(/NAP\s+SQDLand\s+(\d{10})/i);
    if (match && amount > 0) {
        await pool.query("UPDATE users SET balance = balance + $1 WHERE phone = $2", [amount, match[1]]);
        return res.status(200).json({ success: true });
    }
    res.status(200).json({ success: false });
});

// ==========================================
// 4. ĐIỀU HƯỚNG TRANG (FIX LỖI NOT FOUND)
// ==========================================

// Trang chủ
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Các trang HTML con
app.get('/:page.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', req.params.page + '.html'));
});

// Xử lý tất cả các route khác (Refresh trang không lỗi)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 5. KHỞI CHẠY SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 [SQDLand Online] Port: ${PORT}`);
});
