#!/bin/bash
# ============================================
# 股票行情查看器 - 云服务器一键部署脚本
# 适用于：Ubuntu 20.04+ / Debian 10+ / CentOS 7+
# ============================================

set -e

echo "========================================="
echo "  股票行情查看器 - 一键部署脚本"
echo "========================================="

# 1. 安装 Node.js（如果未安装）
if ! command -v node &> /dev/null; then
    echo ""
    echo ">>> [1/5] 安装 Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>/dev/null || {
        # CentOS/RHEL
        curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - 2>/dev/null
        sudo yum install -y nodejs
    }
    sudo apt-get install -y nodejs 2>/dev/null || true
else
    echo ">>> [1/5] Node.js 已安装: $(node -v)"
fi

# 2. 创建项目目录
echo ">>> [2/5] 创建项目目录..."
sudo mkdir -p /opt/stock-viewer
sudo chown $USER:$USER /opt/stock-viewer

# 3. 上传项目文件（如果是从本地上传）
# 如果已经把 stock-viewer.zip 上传到服务器，取消下面的注释：
# echo ">>> [3/5] 解压项目文件..."
# cd /opt
# unzip -o stock-viewer.zip

# 4. 安装依赖
echo ">>> [3/5] 安装依赖..."
cd /opt/stock-viewer
npm install --production
cd client && npm install && npm run build && cd ..

# 5. 配置 systemd 服务（开机自启 + 后台运行）
echo ">>> [4/5] 配置系统服务..."
sudo tee /etc/systemd/system/stock-viewer.service > /dev/null << 'EOF'
[Unit]
Description=Stock Viewer (股票行情查看器)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/stock-viewer
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Port=3000

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable stock-viewer
sudo systemctl start stock-viewer

# 6. 配置防火墙
echo ">>> [5/5] 配置防火墙..."
sudo ufw allow 3000/tcp 2>/dev/null || sudo firewall-cmd --permanent --add-port=3000/tcp 2>/dev/null || true
sudo ufw reload 2>/dev/null || sudo firewall-cmd --reload 2>/dev/null || true

echo ""
echo "========================================="
echo "  ✅ 部署完成！"
echo "========================================="
echo ""
echo "  访问地址: http://你的服务器IP:3000"
echo ""
echo "  常用命令："
echo "    查看状态: sudo systemctl status stock-viewer"
echo "    查看日志: sudo journalctl -u stock-viewer -f"
echo "    重启服务: sudo systemctl restart stock-viewer"
echo "    停止服务: sudo systemctl stop stock-viewer"
echo ""
