# English Learning API

Hệ thống API Node.js cho ứng dụng tự học tiếng Anh với xác thực người dùng, quản lý từ vựng, và tích hợp Dictionary API + Gemini.

## Tính năng

- **Xác thực**: Register, Login với JWT
- **Quản lý từ vựng**: CRUD từ vựng với phân quyền User/Admin
- **Tự động điền thông tin**: Tích hợp Dictionary API và Gemini 2.0 Flash
- **Theo dõi tương tác**: Ghi nhận tương tác người dùng và cập nhật độ khó từ
- **Phân quyền**: User chỉ quản lý từ của mình, Admin quản lý tất cả

## Yêu cầu

- Node.js 14+
- MongoDB
- Gemini API Key (tùy chọn, nếu muốn dùng Gemini)

## Cài đặt

### 1. Clone/Extract dự án
```bash
cd english_learning_api
```

### 2. Cài đặt dependencies
```bash
npm install
```

### 3. Cấu hình biến môi trường
Tạo file `.env` từ `.env.example`:

Linux/macOS:
```bash
cp .env.example .env
```

Windows PowerShell:
```powershell
Copy-Item .env.example .env
```

Chỉnh sửa `.env`:
```
PORT=5000
MONGODB_URI=mongodb://localhost:27017/english_learning
JWT_SECRET=your_super_secret_jwt_key_change_this_in_production
GEMINI_API_KEY=your_gemini_api_key_here
NODE_ENV=development
```

### 4. Chạy server
```bash
npm start
```

Hoặc chế độ development:
```bash
npm run dev
```

Server sẽ chạy tại `http://localhost:5000`

### 5. Nạp dữ liệu từ vựng mẫu (sheet CSV)
Project có sẵn sheet dữ liệu ở `data/seed_words_sheet.csv` với 20 từ vựng mẫu.

Chạy lệnh seed:
```bash
npm run seed:words
```

Script seed sẽ tự tạo user admin mặc định để gán `createdBy`:
- Email: `seed.admin@example.com`
- Username: `seed_admin`
- Password: `seedadmin123`

Bạn có thể đổi các giá trị này bằng biến môi trường:
- `SEED_ADMIN_EMAIL`
- `SEED_ADMIN_USERNAME`
- `SEED_ADMIN_PASSWORD`

Lưu ý: cần MongoDB hoạt động trước khi chạy seed.

## API Endpoints

### Authentication

**Register**
```
POST /api/auth/register
Content-Type: application/json

{
  "username": "john_doe",
  "email": "john@example.com",
  "password": "password123"
}
```

**Login**
```
POST /api/auth/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "password123"
}
```

**Get Current User**
```
GET /api/auth/me
Authorization: Bearer <token>
```

### Words

**Lấy tất cả từ**
```
GET /api/words?level=3&limit=20&skip=0
```

**Lấy chi tiết từ**
```
GET /api/words/:id
```

**Tạo từ mới**
```
POST /api/words
Authorization: Bearer <token>
Content-Type: application/json

{
  "englishWord": "hello",
  "vietnameseWord": "xin chào"
}
```

**Cập nhật từ**
```
PUT /api/words/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "level": 2,
  "topics": ["greeting"],
  "definitions": ["a polite expression of greeting"]
}
```

**Xóa từ**
```
DELETE /api/words/:id
Authorization: Bearer <token>
```

**Ghi nhận tương tác**
```
POST /api/words/:id/interact
Authorization: Bearer <token>
Content-Type: application/json

{
  "isCorrect": true
}
```

## Triển khai lên Render

### 1. Push code lên GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin <your-github-repo>
git push -u origin main
```

### 2. Tạo Web Service trên Render
- Vào https://render.com
- Tạo New > Web Service
- Kết nối GitHub repository
- Cấu hình:
  - **Build Command**: `npm install`
  - **Start Command**: `node server.js`
  - **Environment Variables**:
    - `MONGODB_URI`: MongoDB connection string
    - `JWT_SECRET`: Secret key cho JWT
    - `GEMINI_API_KEY`: Gemini API key
    - `NODE_ENV`: `production`

### 3. Deploy
Render sẽ tự động deploy khi bạn push code lên GitHub.

## Cấu trúc dự án

```
english_learning_api/
├── config/
│   └── database.js          # Cấu hình MongoDB
├── models/
│   ├── User.js              # User schema
│   ├── Word.js              # Word schema
│   └── Interaction.js       # Interaction schema
├── controllers/
│   ├── authController.js    # Auth logic
│   └── wordController.js    # Word logic
├── routes/
│   ├── auth.js              # Auth routes
│   └── words.js             # Word routes
├── middleware/
│   └── auth.js              # JWT middleware
├── utils/
│   └── wordEnricher.js      # Dictionary API + Gemini integration
├── server.js                # Entry point
├── package.json
├── .env.example
├── .gitignore
├── Procfile
└── README.md
```

## Ghi chú

- Dictionary API được sử dụng miễn phí, không cần API key
- Gemini API cần API key từ Google
- Nếu Gemini API không khả dụng, hệ thống sẽ sử dụng Dictionary API
- JWT token hết hạn sau 7 ngày

## License

ISC
