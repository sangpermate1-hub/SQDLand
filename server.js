const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();

// QUAN TRỌNG: Tăng giới hạn JSON lên 50MB để cho phép người dùng Upload ảnh trực tiếp (Base64)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

// Phục vụ các file tĩnh (HTML, CSS, JS, Hình ảnh) từ thư mục hiện tại
app.use(express.static(__dirname));

// ==========================================
// CƠ SỞ DỮ LIỆU (Giả lập bằng file JSON)
// ==========================================
const DB_FILE = path.join(__dirname, 'database.json');

// Khởi tạo file database.json nếu chưa tồn tại
if (!fs.existsSync(DB_FILE)) {
    const initData = {
        users: [
            // Tài khoản Admin mặc định cho GĐ
            { id: 1, full_name: "Phạm Văn Quân", phone: "0971828236", password: "123", balance: 999999999, role: "admin" }
        ],
        properties: [],
        news: []
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initData, null, 2));
}

// Hàm đọc/ghi DB
const readDB = () => JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
const writeDB = (data) => fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));

// ==========================================
// API XÁC THỰC (ĐĂNG KÝ / ĐĂNG NHẬP)
// ==========================================

// 1. Đăng ký
app.post('/api/auth/register', (req, res) => {
    const { full_name, phone, password } = req.body;
    const db = readDB();

    if (db.users.find(u => u.phone === phone)) {
        return res.status(400).json({ success: false, message: "Số điện thoại này đã được đăng ký!" });
    }

    const newUser = {
        id: Date.now(),
        full_name,
        phone,
        password, // Thực tế nên mã hóa (bcrypt), đây là bản demo
        balance: 0,
        role: "user"
    };

    db.users.push(newUser);
    writeDB(db);

    // Trả về dữ liệu user (ẩn password) để client tự động đăng nhập
    const { password: _, ...userWithoutPass } = newUser;
    res.status(200).json({ success: true, message: "Đăng ký thành công!", user: userWithoutPass });
});

// 2. Đăng nhập
app.post('/api/auth/login', (req, res) => {
    const { phone, password } = req.body;
    const db = readDB();

    const user = db.users.find(u => u.phone === phone && u.password === password);
    
    if (user) {
        const { password: _, ...userWithoutPass } = user;
        res.status(200).json({ success: true, user: userWithoutPass });
    } else {
        res.status(401).json({ success: false, message: "Sai số điện thoại hoặc mật khẩu." });
    }
});

// ==========================================
// API BẤT ĐỘNG SẢN (PROPERTIES)
// ==========================================

// 1. Lấy danh sách BĐS (Có lọc)
app.get('/api/properties', (req, res) => {
    const db = readDB();
    let props = db.properties;

    // Lọc theo query params nếu có
    const { category, location } = req.query;
    if (category) props = props.filter(p => p.category === category);
    if (location) props = props.filter(p => p.location && p.location.includes(location));

    res.status(200).json(props);
});

// 2. Lấy chi tiết 1 BĐS
app.get('/api/properties/:id', (req, res) => {
    const db = readDB();
    const prop = db.properties.find(p => p.id == req.params.id);
    if (prop) {
        // Trả về dạng mảng 1 phần tử (để khớp với logic Frontend cũ của anh)
        res.status(200).json([prop]);
    } else {
        res.status(404).json({ message: "Không tìm thấy tài sản." });
    }
});

// 3. Đăng tin BĐS mới
app.post('/api/properties', (req, res) => {
    const db = readDB();
    const newProp = {
        id: Date.now(),
        created_at: new Date().toISOString(),
        ...req.body
    };
    
    db.properties.push(newProp);
    
    // Nếu không phải admin đăng, trừ 20k
    if (req.body.user_id) {
        const userIndex = db.users.findIndex(u => u.id === req.body.user_id);
        if (userIndex !== -1 && db.users[userIndex].role !== 'admin') {
            if (db.users[userIndex].balance < 20000) {
                return res.status(400).json({ success: false, message: "Số dư không đủ 20.000đ để đăng tin." });
            }
            db.users[userIndex].balance -= 20000;
        }
    }

    writeDB(db);
    res.status(200).json({ success: true, property: newProp });
});

// 4. Xóa tin BĐS
app.delete('/api/properties/:id', (req, res) => {
    const db = readDB();
    const initialLength = db.properties.length;
    db.properties = db.properties.filter(p => p.id != req.params.id);
    
    if (db.properties.length < initialLength) {
        writeDB(db);
        res.status(200).json({ success: true, message: "Xóa tin thành công." });
    } else {
        res.status(404).json({ success: false, message: "Không tìm thấy tin." });
    }
});

// 5. Nâng cấp tin VIP
app.put('/api/properties/:id/vip', (req, res) => {
    const db = readDB();
    const propIndex = db.properties.findIndex(p => p.id == req.params.id);
    
    if (propIndex !== -1) {
        db.properties[propIndex].is_vip = true;
        writeDB(db);
        res.status(200).json({ success: true, message: "Đã nâng cấp VIP." });
    } else {
        res.status(404).json({ success: false, message: "Không tìm thấy tin." });
    }
});

// ==========================================
// API TIN TỨC & PHÂN TÍCH (NEWS)
// ==========================================

app.get('/api/news', (req, res) => {
    const db = readDB();
    // Sắp xếp bài mới nhất lên đầu
    const sortedNews = db.news.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.status(200).json(sortedNews);
});

app.get('/api/news/:id', (req, res) => {
    const db = readDB();
    const article = db.news.find(n => n.id == req.params.id);
    if (article) {
        res.status(200).json([article]);
    } else {
        res.status(404).json({ message: "Không tìm thấy bài viết." });
    }
});

app.post('/api/news', (req, res) => {
    const db = readDB();
    const newArticle = {
        id: Date.now(),
        created_at: new Date().toISOString(),
        author: "Phạm Văn Quân",
        ...req.body
    };
    db.news.push(newArticle);
    writeDB(db);
    res.status(200).json({ success: true, article: newArticle });
});

// ==========================================
// API ADMIN & TÀI CHÍNH (SEPAY / TOPUP)
// ==========================================

// API Cấp tiền thủ công từ Admin
app.post('/api/admin/topup', (req, res) => {
    const { phone, amount } = req.body;
    const db = readDB();

    const userIndex = db.users.findIndex(u => u.phone === phone);
    if (userIndex !== -1) {
        db.users[userIndex].balance += Number(amount);
        writeDB(db);
        res.status(200).json({ success: true, message: `Đã nạp thành công ${amount}đ cho SĐT: ${phone}` });
    } else {
        res.status(404).json({ success: false, message: "Không tìm thấy số điện thoại đối tác trong hệ thống." });
    }
});

// ==========================================
// API WEBHOOK SEPAY (NẠP TIỀN TỰ ĐỘNG)
// ==========================================
app.post('/api/webhook/sepay', (req, res) => {
    // 1. Lấy dữ liệu SePay đẩy về
    const payload = req.body;
    
    // In ra log để anh dễ kiểm tra trên Railway
    console.log("🔔 [Webhook SePay] Nhận giao dịch mới:", payload);

    // SePay thường trả về số tiền ở biến transferAmount và nội dung ở content (hoặc transactionContent)
    const amount = payload.transferAmount || payload.amountIn || 0; 
    const content = payload.content || payload.transactionContent || "";

    // Nếu không có tiền vào hoặc không có nội dung thì bỏ qua
    if (amount <= 0 || !content) {
        return res.status(200).json({ success: true, message: "Bỏ qua giao dịch không hợp lệ" });
    }

    // 2. Dùng Regex để quét tìm cú pháp: NAP SQDLand [SỐ_ĐIỆN_THOẠI]
    // /NAP\s+SQDLand\s+(\d{10})/i : Không phân biệt hoa thường, cho phép khoảng trắng tùy ý, tìm đúng 10 số
    const match = content.match(/NAP\s+SQDLand\s+(\d{10})/i);

    if (match) {
        const phone = match[1]; // Lấy ra số điện thoại từ nội dung
        
        const db = readDB();
        const userIndex = db.users.findIndex(u => u.phone === phone);

        if (userIndex !== -1) {
            // 3. Cộng tiền vào tài khoản
            db.users[userIndex].balance += Number(amount);
            writeDB(db);
            
            console.log(`✅ [Webhook SePay] NẠP THÀNH CÔNG ${amount}đ cho tài khoản: ${phone}`);
            return res.status(200).json({ success: true, message: "Nạp tiền thành công" });
        } else {
            console.log(`❌ [Webhook SePay] LỖI: Không tìm thấy SĐT ${phone} trong hệ thống!`);
            return res.status(200).json({ success: false, message: "SĐT không tồn tại" }); 
            // Vẫn trả về 200 để SePay hiểu là code đã chạy xong, không gửi lại nữa
        }
    }

    // Giao dịch chuyển tiền với nội dung khác (Không phải nạp tiền)
    return res.status(200).json({ success: true, message: "Giao dịch ngoài hệ thống SQDLand" });
});

// Chuyển hướng mọi route không tồn tại về index.html (Hỗ trợ SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ==========================================
// KHỞI ĐỘNG SERVER (CHUẨN CHO RAILWAY)
// ==========================================
// Cực kỳ quan trọng: Lắng nghe ở 0.0.0.0 để Railway có thể nhận diện được
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Hệ thống SQDLand đang chạy tại cổng ${PORT}`);
    console.log(`Thư mục lưu trữ: ${DB_FILE}`);
});
