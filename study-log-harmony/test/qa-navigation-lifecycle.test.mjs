import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, session } from './qa-task-fixture.mjs';

test('hidden-module failures do not become current history errors and reentry can retry',async()=>{
 const f=await fixture();let active=true,binding='A',reject;
 const pending=new Promise((_resolve,r)=>{reject=r;});
 f.transport.getConnectionBinding=()=>binding;f.transport.get=async()=>pending;
 const view={active:()=>active,connected:()=>binding==='A',busy:()=>false,setBusy(){},activeSession:()=>'',clearSession(){}};
 const nav=new f.QaNavigationController(f.transport,view),saved=session();nav.acceptQaNavigation([saved]);
 const loading=nav.loadQaNavigation();active=false;reject(Error('late network failure'));await loading;
 assert.equal(nav.qaNavigationLoading,false);assert.equal(nav.qaNavigationError,'');assert.equal(nav.qaSessions[0].id,saved.id);
 active=true;f.transport.get=async()=>{throw Error('current failure');};await nav.loadQaNavigation();
 assert.equal(nav.qaNavigationError,'历史问答读取失败');assert.equal(nav.qaSessions[0].id,saved.id);
 f.transport.get=async()=>({sessions:[saved]});await nav.loadQaNavigation();assert.equal(nav.qaNavigationError,'');
});

test('a different connection cannot install a late history response',async()=>{
 const f=await fixture();let binding='A',resolve;
 f.transport.getConnectionBinding=()=>binding;f.transport.get=async()=>new Promise(r=>{resolve=r;});
 const nav=new f.QaNavigationController(f.transport,{active:()=>true,connected:()=>true,busy:()=>false,setBusy(){},activeSession:()=>'',clearSession(){}});
 const saved=session();nav.acceptQaNavigation([saved]);const reading=nav.loadQaNavigation();binding='B';resolve({sessions:[session()]});await reading;
 assert.equal(nav.qaSessions[0].id,saved.id);assert.equal(nav.qaNavigationLoading,false);assert.equal(nav.qaNavigationError,'');
});
