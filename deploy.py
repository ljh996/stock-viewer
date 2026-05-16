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

dist_dir = r'D:\agentAIdemo\stock-viewer\stock-viewer\client\dist'
remote_dist = '/var/www/stock-viewer/client/dist'

# Clean remote dist
stdin, stdout, stderr = client.exec_command('rm -rf /var/www/stock-viewer/client/dist/*')
stdout.channel.recv_exit_status()

stdin, stdout, stderr = client.exec_command('mkdir -p /var/www/stock-viewer/client/dist/assets')
stdout.channel.recv_exit_status()

sftp = client.open_sftp()

for root, dirs, files in os.walk(dist_dir):
    for fname in files:
        local_path = os.path.join(root, fname)
        rel_path = os.path.relpath(local_path, dist_dir)
        remote_path = remote_dist + '/' + rel_path.replace('\\', '/')
        print('Uploading: ' + rel_path)
        sftp.put(local_path, remote_path)

sftp.close()

print('\n=== DEPLOYED ===')
stdin, stdout, stderr = client.exec_command('find /var/www/stock-viewer/client/dist/ -type f | sort')
print(stdout.read().decode('utf-8', errors='replace'))

stdin, stdout, stderr = client.exec_command('pm2 restart stock-viewer')
print(stdout.read().decode('utf-8', errors='replace'))

client.close()
print('Deploy complete!')
