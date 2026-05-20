import paramiko, os, sys, re

# 自动加载 local-config.ps1（如果存在）
config_path = os.path.join(os.path.dirname(__file__), 'local-config.ps1')
if os.path.exists(config_path):
    with open(config_path, 'r', encoding='utf-8') as f:
        for line in f:
            m = re.match(r'\$env:(\w+)\s*=\s*"([^"]*)"', line)
            if m:
                os.environ.setdefault(m.group(1), m.group(2))

host = os.environ.get('DEPLOY_HOST')
password = os.environ.get('DEPLOY_PASSWORD')
username = os.environ.get('DEPLOY_USER', 'root')

if not host or not password:
    print('Error: 请设置环境变量 DEPLOY_HOST 和 DEPLOY_PASSWORD')
    print('提示：可创建 local-config.ps1 文件（已加入 .gitignore）')
    sys.exit(1)

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username=username, password=password, timeout=10)

base_dir = os.path.dirname(os.path.abspath(__file__))
remote_base = '/opt/stock-viewer'

# 1. 上传 server/index.js
local_server = os.path.join(base_dir, 'server', 'index.js')
remote_server = remote_base + '/server/index.js'
print('Uploading server/index.js...')
sftp = client.open_sftp()
sftp.put(local_server, remote_server)
print('  OK')

# 2. 上传前端 dist
dist_dir = os.path.join(base_dir, 'client', 'dist')
remote_dist = remote_base + '/client/dist'

# Clean remote dist
stdin, stdout, stderr = client.exec_command('rm -rf ' + remote_dist + '/*')
stdout.channel.recv_exit_status()
stdin, stdout, stderr = client.exec_command('mkdir -p ' + remote_dist + '/assets')
stdout.channel.recv_exit_status()

for root, dirs, files in os.walk(dist_dir):
    for fname in files:
        local_path = os.path.join(root, fname)
        rel_path = os.path.relpath(local_path, dist_dir)
        remote_path = remote_dist + '/' + rel_path.replace('\\', '/')
        print('Uploading: ' + rel_path)
        sftp.put(local_path, remote_path)

sftp.close()

print('\n=== DEPLOYED ===')
stdin, stdout, stderr = client.exec_command('find ' + remote_base + '/client/dist/ -type f | sort')
print(stdout.read().decode('utf-8', errors='replace'))

# Restart: kill old process and start new one
stdin, stdout, stderr = client.exec_command(
    "ps aux | grep 'node.*index.js' | grep -v grep | awk '{print $2}' | head -1"
)
old_pid = stdout.read().decode('utf-8', errors='replace').strip()
if old_pid:
    print(f'Killing old process (PID: {old_pid})...')
    client.exec_command('kill ' + old_pid)

stdin, stdout, stderr = client.exec_command(
    'cd /opt/stock-viewer && nohup node server/index.js > server.log 2>&1 &'
)
print('New server process started')

client.close()
print('Deploy complete!')
