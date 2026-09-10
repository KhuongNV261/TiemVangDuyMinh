# DNTN Vàng Bạc Trang Sức Duy Minh – Website Bảng Giá Vàng

## Cài đặt & Chạy

```bash
npm install
node server.js
```

Truy cập: http://localhost:3000

## Trang

- `/` – Bảng giá vàng công khai
- `/admin` – Trang quản trị (cần mật khẩu)

## Mật khẩu mặc định

```
admin123
```

> Hãy đổi mật khẩu ngay sau khi đăng nhập lần đầu!

## Deploy lên VPS / subdomain vangbacduyminh.khuong2601.io.vn

### Yêu cầu:
- Node.js 18+
- PM2 (quản lý process)
- Nginx (reverse proxy)

### Bước 1: Upload lên server
```bash
scp -r ./vangbacduyminh user@your-server-ip:/var/www/
```

### Bước 2: Cài dependencies
```bash
cd /var/www/vangbacduyminh
npm install --production
```

### Bước 3: Chạy bằng PM2
```bash
npm install -g pm2
pm2 start server.js --name vangbacduyminh
pm2 save
pm2 startup
```

### Bước 4: Cấu hình Nginx
```nginx
server {
    listen 80;
    server_name vangbacduyminh.khuong2601.io.vn;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

### Bước 5: SSL (HTTPS) với Certbot
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d vangbacduyminh.khuong2601.io.vn
```

### Bước 6: DNS
Thêm record A tại nhà cung cấp domain:
```
Type: A
Name: vangbacduyminh
Value: <IP máy chủ của bạn>
TTL: 3600
```

## Cấu trúc dự án
```
vangbacduyminh/
├── server.js          # Express server + API
├── data.json          # Dữ liệu giá vàng (tự động cập nhật)
├── package.json
├── public/
│   ├── index.html     # Bảng giá vàng (công khai)
│   └── admin.html     # Trang quản trị
└── README.md
```
