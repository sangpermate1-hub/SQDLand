const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json()); // Thay thế bodyParser

// Phục vụ 11 file giao diện HTML từ thư mục 'public'
app.use(express.static('public'));

// =========================================================
// KẾT NỐI CƠ SỞ DỮ LIỆU NEON CLOUD
// (Hãy copy Connection String của bạn vào đây)
// =========================================================
const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_aO9xrYeGiZC2@ep-patient-snow-aiu0gv3b-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
});

// =========================================================
// 1. API HỆ THỐNG ĐỐI TÁC (ĐĂNG KÝ / ĐĂNG NHẬP)
// =========================================================

// Đăng ký tài khoản
app.post('/api/auth/register', async (req, res) => {
    const { full_name, phone, password } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO users (full_name, phone, password) VALUES ($1, $2, $3) RETURNING id',
            [full_name, phone, password]
        );
        res.json({ success: true, userId: result.rows[0].id });
    } catch (err) {
        res.status(400).json({ success: false, message: "Số điện thoại này đã tồn tại trong mạng lưới!" });
    }
});

// Đăng nhập
app.post('/api/auth/login', async (req, res) => {
    const { phone, password } = req.body;
    try {
        const result = await pool.query(
            'SELECT id, full_name, phone, balance, role FROM users WHERE phone = $1 AND password = $2', 
            [phone, password]
        );
        if (result.rows.length > 0) {
            res.json({ success: true, user: result.rows[0] });
        } else {
            res.status(401).json({ success: false, message: "Sai số điện thoại hoặc mật khẩu!" });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: "Lỗi kết nối máy chủ." });
    }
});

// =========================================================
// 2. API QUẢN TRỊ (ADMIN)
// =========================================================

// Admin Cấp ngân sách cho Sale
app.post('/api/admin/topup', async (req, res) => {
    const { phone, amount } = req.body; 
    try {
        const result = await pool.query(
            'UPDATE users SET balance = balance + $1 WHERE phone = $2 RETURNING id',
            [amount, phone]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Không tìm thấy Đối tác với số điện thoại này." });
        }
        res.json({ success: true, message: `Đã cấp ${amount}đ cho SĐT: ${phone}` });
    } catch (err) {
        res.status(500).json({ success: false, message: "Lỗi máy chủ khi nạp tiền." });
    }
});

// =========================================================
// 3. API RỔ HÀNG BẤT ĐỘNG SẢN (MUA BÁN)
// =========================================================

// Thêm Bất động sản mới (Tự động duyệt)
app.post('/api/properties', async (req, res) => {
    const { user_id, title, category, location, price, area, description, legal_status, phone, images } = req.body;
    
    try {
        await pool.query('BEGIN'); // Bắt đầu giao dịch an toàn

        // 1. Kiểm tra ngân sách người dùng
        const userRes = await pool.query('SELECT balance, role FROM users WHERE id = $1', [user_id]);
        if (userRes.rows.length === 0) throw new Error("Tài khoản không hợp lệ.");
        
        const user = userRes.rows[0];

        // 2. Trừ phí 20.000đ (Trừ Giám đốc)
        if (user.role !== 'admin') {
            if (user.balance < 20000) throw new Error("Ngân sách không đủ 20.000đ để niêm yết.");
            await pool.query('UPDATE users SET balance = balance - 20000 WHERE id = $1', [user_id]);
        }

        // 3. Lưu vào kho hàng
        await pool.query(
            `INSERT INTO properties 
            (user_id, title, category, location, price, area, description, legal_status, phone, images) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [user_id, title, category, location, price, area, description, legal_status, phone, images]
        );

        await pool.query('COMMIT'); 
        res.json({ success: true, message: "Niêm yết thành công!" });
    } catch (err) {
        await pool.query('ROLLBACK');
        res.status(400).json({ success: false, message: err.message });
    }
});

// Lấy danh sách rổ hàng (Có hỗ trợ bộ lọc Tìm kiếm)
app.get('/api/properties', async (req, res) => {
    try {
        const { category, location } = req.query;
        let queryStr = `
            SELECT p.*, u.full_name, u.role 
            FROM properties p 
            JOIN users u ON p.user_id = u.id 
            WHERE p.status = 'active'
        `;
        let params = [];
        let paramCount = 1;

        if (category) {
            queryStr += ` AND p.category = $${paramCount}`;
            params.push(category);
            paramCount++;
        }
        if (location) {
            queryStr += ` AND p.location ILIKE $${paramCount}`; // ILIKE để tìm kiếm ko phân biệt hoa thường
            params.push(`%${location}%`);
            paramCount++;
        }

        queryStr += ` ORDER BY p.created_at DESC`;

        const result = await pool.query(queryStr, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: "Lỗi truy xuất dữ liệu." });
    }
});

// Lấy chi tiết 1 Bất động sản
app.get('/api/properties/:id', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT p.*, u.full_name, u.role 
             FROM properties p 
             JOIN users u ON p.user_id = u.id 
             WHERE p.id = $1`, [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: "Không tìm thấy" });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ message: "Lỗi máy chủ" });
    }
});

// =========================================================
// 4. API DỰ ÁN (PROJECTS)
// =========================================================

app.get('/api/projects', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM projects ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: "Lỗi lấy danh sách dự án." });
    }
});

// =========================================================
// 5. API TIN TỨC (NEWS)
// =========================================================

// Thêm bài viết mới
app.post('/api/news', async (req, res) => {
    const { title, category, thumbnail, content } = req.body;
    try {
        await pool.query(
            'INSERT INTO news (title, category, thumbnail, content) VALUES ($1, $2, $3, $4)',
            [title, category, thumbnail, content]
        );
        res.json({ success: true, message: "Xuất bản bài phân tích thành công!" });
    } catch (err) {
        res.status(400).json({ success: false, message: "Lỗi xuất bản tin tức." });
    }
});

// Lấy danh sách tin tức
app.get('/api/news', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM news ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: "Lỗi tải bản tin." });
    }
});

// Lấy chi tiết 1 bài tin tức
app.get('/api/news/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM news WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ message: "Không tìm thấy" });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ message: "Lỗi máy chủ" });
    }
});

// =========================================================
// KHỞI ĐỘNG MÁY CHỦ
// =========================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(`🚀 HỆ THỐNG SQDLAND ĐANG HOẠT ĐỘNG!`);
    console.log(`🌐 Truy cập ngay tại: http://localhost:${PORT}`);
    console.log(`=================================================`);
});
