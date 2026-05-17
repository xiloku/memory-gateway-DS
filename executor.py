import http.server
import json
import subprocess
import os

class Executor(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        # 只处理发送到 /execute 的请求
        if self.path != '/execute':
            self.send_response(404)
            self.end_headers()
            return

        content_length = int(self.headers['Content-Length'])
        body = self.rfile.read(content_length)
        
        try:
            data = json.loads(body)
            command = data.get('command', '')
            
            if not command:
                self.send_json({'error': '缺少 command 参数'}, 400)
                return
            
            # 执行命令
            result = subprocess.run(
                command, shell=True, capture_output=True, text=True,
                timeout=30, cwd='/workspace'
            )
            
            self.send_json({
                'success': result.returncode == 0,
                'stdout': result.stdout.strip(),
                'stderr': result.stderr.strip()
            })
        except subprocess.TimeoutExpired:
            self.send_json({'error': '命令执行超时'}, 500)
        except Exception as e:
            self.send_json({'error': str(e)}, 500)

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode())

if __name__ == '__main__':
    server = http.server.HTTPServer(('0.0.0.0', 3100), Executor)
    print('DeepSeek 控制台已启动，监听 0.0.0.0:3100')
    server.serve_forever()
