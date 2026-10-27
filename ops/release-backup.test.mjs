import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const script = new URL('./release-backup.py', import.meta.url);
test('frozen data remains consistent after live data changes; corruption and unsafe paths fail', () => {
 const code=String.raw`import importlib.util,tempfile,sqlite3,json,sys,threading
from http.server import HTTPServer,BaseHTTPRequestHandler
sys.dont_write_bytecode=True
from pathlib import Path
spec=importlib.util.spec_from_file_location('backup',${JSON.stringify(fileURLToPath(script))});m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as temporary:
 root=Path(temporary);data=root/'live';data.mkdir();(data/'notes.md').write_text('before')
 db=sqlite3.connect(data/'state.sqlite');db.execute('create table records (value text)');db.execute("insert into records values ('before')");db.commit();db.close()
 snapshot=root/'frozen';report=m.freeze(data,snapshot)
 (data/'notes.md').write_text('after');result=m.archive(snapshot,root/'backup.tar.gz')
 assert (snapshot/'notes.md').read_text()=='before' and result['verifiedFiles']==2
 try:m.freeze(data,data/'unsafe')
 except RuntimeError:pass
 else:raise AssertionError('nested snapshot accepted')
 (snapshot/'notes.md').write_text('corrupt')
 try:m.archive(snapshot,root/'corrupt.tar.gz')
 except RuntimeError:pass
 else:raise AssertionError('changed snapshot accepted')
 class Handler(BaseHTTPRequestHandler):
  calls=0
  def do_GET(self):
   Handler.calls+=1;self.send_response(503 if Handler.calls<=2 else 401);self.end_headers()
  def log_message(self,*args):pass
 server=HTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever);thread.start()
 try:
  checked=m.probe('http://127.0.0.1:'+str(server.server_port)+'/study-log/api/auth/me',0.8)
  assert checked['endedReady'] and checked['longestObservedUnavailableMs']>0
 finally:server.shutdown();server.server_close();thread.join()
 print(json.dumps({'passed':True,'freezeMs':report['freezeMs']}))`;
 const result=JSON.parse(execFileSync('python',['-c',code],{encoding:'utf8',windowsHide:true}));assert.equal(result.passed,true);
});
