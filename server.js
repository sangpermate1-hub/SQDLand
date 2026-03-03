const express = require('express');
const path = require('path');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();

// Cấu hình giới hạn dữ liệu 50MB cho ảnh Base64
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

// Phục vụ file tĩnh
app.use(express.static(__dirname));

// ==========================================
// CƠ SỞ DỮ LIỆU NEON.TECH (PostgreSQL)
// ==========================================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL, // Lấy từ biến môi trường Railway
    ssl: { rejectUnauthorized: false } // Bắt buộc khi dùng Neon
});

// Khởi tạo các bảng nếu chưa tồn tại
const initDB = async () => {
    try {
        const client = await pool.connect();
        // Bảng Người dùng
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
        // Bảng Bất động sản
        await client.query(`
            CREATE TABLE IF NOT EXISTS properties (
                id SERIAL PRIMARY KEY,
                user_id INTEGER,
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
        // Bảng Tin tức
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
        // Bảng Cấu hình Admin (Ngân hàng)
        await client.query(`
            CREATE TABLE IF NOT EXISTS configs (
                id INTEGER PRIMARY KEY DEFAULT 1,
                bank TEXT,
                account_name TEXT,
                account_number TEXT
            )
        `);
        
        // Tạo tài khoản Admin mặc định nếu chưa có
        await client.query(`
            INSERT INTO users (full_name, phone, password, balance, role)
            VALUES ('Phạm Văn Quân', '0981593935', '123', 999999999, 'admin')
            ON CONFLICT (phone) DO NOTHING
        `);

        client.release();
        console.log("🐘 Đã kết nối và đồng bộ Database Neon.tech thành công!");
    } catch (err) {
        console.error("❌ Lỗi khởi tạo Database:", err);
    }
};
initDB();

// ==========================================
// 1. API XÁC THỰC (AUTH)
// ==========================================

app.post('/api/auth/register', async (req, res) => {
    const { full_name, phone, password } = req.body;
    try {
        const result = await pool.query(
            "INSERT INTO users (full_name, phone, password) VALUES ($1, $2, $3) RETURNING id, full_name, phone, balance, role",
            [full_name, phone, password]
        );
        res.status(200).json({ success: true, user: result.rows[0] });
    } catch (err) {
        res.status(400).json({ success: false, message: "Số điện thoại đã tồn tại!" });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { phone, password } = req.body;
    try {
        const result = await pool.query(
            "SELECT id, full_name, phone, balance, role FROM users WHERE phone = $1 AND password = $2",
            [phone, password]
        );
        if (result.rows.length > 0) {
            res.status(200).json({ success: true, user: result.rows[0] });
        } else {
            res.status(401).json({ success: false, message: "Sai tài khoản hoặc mật khẩu!" });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: "Lỗi hệ thống" });
    }
});

// ==========================================
// 2. API BẤT ĐỘNG SẢN (PROPERTIES)
// ==========================================

app.get('/api/properties', async (req, res) => {
    try {
        const { category, location } = req.query;
        let sql = "SELECT p.*, u.full_name, u.role FROM properties p LEFT JOIN users u ON p.user_id = u.id WHERE 1=1";
        const params = [];
        
        if (category) {
            params.push(category);
            sql += ` AND p.category = $${params.length}`;
        }
        if (location) {
            params.push(`%${location}%`);
            sql += ` AND p.location ILIKE $${params.length}`;
        }
        
        sql += " ORDER BY p.is_vip DESC, p.created_at DESC";
        const result = await pool.query(sql, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json([]);
    }
});

app.get('/api/properties/:id', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM properties WHERE id = $1", [req.params.id]);
        res.json(result.rows); // Trả về mảng 1 phần tử cho khớp frontend
    } catch (err) {
        res.status(404).json([]);
    }
});

app.post('/api/properties', async (req, res) => {
    const { user_id, title, category, location, price, area, description, legal_status, images } = req.body;
    try {
        // Kiểm tra số dư và trừ tiền (20,000đ) nếu không phải admin
        const userCheck = await pool.query("SELECT balance, role FROM users WHERE id = $1", [user_id]);
        const user = userCheck.rows[0];

        if (user.role !== 'admin') {
            if (Number(user.balance) < 20000) return res.status(400).json({ message: "Số dư không đủ 20.000đ" });
            await pool.query("UPDATE users SET balance = balance - 20000 WHERE id = $1", [user_id]);
        }

        const result = await pool.query(
            "INSERT INTO properties (user_id, title, category, location, price, area, description, legal_status, images) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *",
            [user_id, title, category, location, price, area, description, legal_status, images]
        );
        res.json({ success: true, property: result.rows[0] });
    } catch (err) {
        res.status(500).json({ message: "Lỗi đăng tin" });
    }
});

app.delete('/api/properties/:id', async (req, res) => {
    try {
        await pool.query("DELETE FROM properties WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.put('/api/properties/:id/vip', async (req, res) => {
    try {
        const propRes = await pool.query("SELECT user_id FROM properties WHERE id = $1", [req.params.id]);
        const userId = propRes.rows[0].user_id;
        
        const userRes = await pool.query("SELECT balance, role FROM users WHERE id = $1", [userId]);
        const user = userRes.rows[0];

        if (user.role !== 'admin') {
            if (Number(user.balance) < 50000) return res.status(400).json({ message: "Số dư không đủ 50.000đ" });
            await pool.query("UPDATE users SET balance = balance - 50000 WHERE id = $1", [userId]);
        }

        await pool.query("UPDATE properties SET is_vip = TRUE WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: "Lỗi nâng cấp" });
    }
});

// ==========================================
// 3. API TIN TỨC (NEWS)
// ==========================================

app.get('/api/news', async (req, res) => {
    const result = await pool.query("SELECT * FROM news ORDER BY created_at DESC");
    res.json(result.rows);
});

app.post('/api/news', async (req, res) => {
    const { title, category, thumbnail, content } = req.body;
    await pool.query(
        "INSERT INTO news (title, category, thumbnail, content) VALUES ($1, $2, $3, $4)",
        [title, category, thumbnail, content]
    );
    res.json({ success: true });
});

// ==========================================
// 4. TÀI CHÍNH & WEBHOOK (KHÔNG DÙNG CHỮ SEPAY)
// ==========================================

// Webhook nạp tiền tự động
app.post('/api/webhook/transaction', async (req, res) => {
    const payload = req.body;
    const amount = payload.transferAmount || payload.amountIn || 0;
    const content = payload.content || payload.transactionContent || "";

    console.log(`🔔 Giao dịch mới: ${amount}đ - Nội dung: ${content}`);

    const match = content.match(/NAP\s+SQDLand\s+(\d{10})/i);
    if (match && amount > 0) {
        const phone = match[1];
        try {
            const update = await pool.query("UPDATE users SET balance = balance + $1 WHERE phone = $2 RETURNING id", [amount, phone]);
            if (update.rowCount > 0) {
                console.log(`✅ Đã nạp ${amount}đ cho đối tác ${phone}`);
                return res.status(200).json({ success: true });
            }
        } catch (e) { console.error(e); }
    }
    res.status(200).json({ success: false });
});

// Cấu hình ngân hàng
app.post('/api/admin/config-bank', async (req, res) => {
    const { bank, account_name, account_number } = req.body;
    await pool.query(
        "INSERT INTO configs (id, bank, account_name, account_number) VALUES (1, $1, $2, $3) ON CONFLICT (id) DO UPDATE SET bank=$1, account_name=$2, account_number=$3",
        [bank, account_name, account_number]
    );
    res.json({ success: true });
});

app.get('/api/config-bank', async (req, res) => {
    const result = await pool.query("SELECT * FROM configs WHERE id = 1");
    res.json(result.rows[0] || {});
});

// Nạp tiền thủ công
app.post('/api/admin/topup', async (req, res) => {
    const { phone, amount } = req.body;
    const result = await pool.query("UPDATE users SET balance = balance + $1 WHERE phone = $2", [amount, phone]);
    if (result.rowCount > 0) res.json({ success: true, message: "Đã nạp tiền thành công" });
    else res.status(404).json({ message: "Không tìm thấy SĐT" });
});

// Điều hướng SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// KHỞI CHẠY (Port 0.0.0.0 cho Railway)
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 SQDLand Server is running on port ${PORT}`);
});
