# ============================================
# 一键部署脚本（在 VSCode 终端中运行）
# 用法：.\deploy.ps1
# ============================================

$SERVER = "root@47.116.51.148"
$REMOTE_DIR = "/opt/stock-viewer"
$LOCAL_DIR = $PSScriptRoot

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  🚀 一键部署到服务器" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# 1. 构建前端
Write-Host ""
Write-Host "[1/4] 构建前端..." -ForegroundColor Yellow
Set-Location "$LOCAL_DIR\client"
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 前端构建失败！" -ForegroundColor Red
    exit 1
}

# 2. 打包（只打包需要的文件）
Write-Host ""
Write-Host "[2/4] 打包项目文件..." -ForegroundColor Yellow
Set-Location $LOCAL_DIR
$zipFile = "$LOCAL_DIR\deploy.zip"
if (Test-Path $zipFile) { Remove-Item $zipFile }
Compress-Archive -Path "server\*", "python\*", "client\dist\*", "client\package.json", "package.json" -DestinationPath $zipFile
Write-Host "  ✅ 打包完成: deploy.zip" -ForegroundColor Green

# 3. 上传到服务器
Write-Host ""
Write-Host "[3/4] 上传到服务器..." -ForegroundColor Yellow
scp $zipFile "$SERVER`:/tmp/deploy.zip"
Write-Host "  ✅ 上传完成" -ForegroundColor Green

# 4. 在服务器上解压并重启
Write-Host ""
Write-Host "[4/4] 解压并重启服务..." -ForegroundColor Yellow
ssh $SERVER @"
    cd $REMOTE_DIR
    # 备份 python 目录（保留已安装的依赖）
    cp -r python/api.py python/api.py.bak 2>/dev/null
    # 解压新文件
    cd /tmp && unzip -o deploy.zip -d $REMOTE_DIR
    # 恢复 python 依赖（不覆盖 node_modules）
    cd $REMOTE_DIR
    # 重启服务
    systemctl restart stock-viewer
    systemctl restart stock-python
    echo ''
    echo '=== 服务状态 ==='
    systemctl is-active stock-viewer
    systemctl is-active stock-python
"@

# 清理
Remove-Item $zipFile

Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host "  ✅ 部署完成！" -ForegroundColor Green
Write-Host "  🌐 http://47.116.51.148:3000" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Green
