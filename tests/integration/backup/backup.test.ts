// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, connect, content, fixture, phrase, rawStores } from '../storage/fixture'
import { MAX_BACKUP_BYTES, parseBackup } from '../../../src/core/export/backup'
import { JournalError } from '../../../src/core/journal'

afterEach(async () => { vi.restoreAllMocks(); await cleanup() })
async function source() {
 const f=await fixture();const root=await f.service.createEntry(f.session,content)
 await f.service.editEntry(f.session,root.entryId,root.revisionId,{...content,body:'Synthetic final exported body'})
 return {...f,root}
}
async function emptyStores(db: Awaited<ReturnType<typeof connect>>['db']) { for(const table of db.tables)expect(await table.count()).toBe(0) }

describe('M4 complete authenticated portable backup and restoration',()=>{
 it('round trips canonical bytes, both wrappers, original DAG and a new local-only device',async()=>{
  const f=await source();const bytes=await f.service.prepareEncryptedBackup(f.session)
  const doc=parseBackup(bytes);expect(doc.version).toBe(2)
  expect(doc.revisions).toHaveLength(2)
  const text=new TextDecoder().decode(bytes)
  for(const secret of [content.title,content.body,phrase,f.recoveryKey])expect(text).not.toContain(secret)
  expect(doc).not.toHaveProperty('device');expect(doc).not.toHaveProperty('sync_queue')
  const target=await connect();const handle=await target.service.prepareBackupRestore(bytes,phrase,'passphrase')
  expect(target.service.backupRestoreSummary(handle)).toMatchObject({entries:1,trash:0,needsPassphrase:false})
  await emptyStores(target.db)
  const restored=await target.service.commitBackupRestore(handle)
  expect(restored.journalId).toBe(f.journalId)
  expect((await target.service.readEntry(restored.session,f.root.entryId)).payload.body).toBe('Synthetic final exported body')
  expect(await target.db.journal_revisions.toArray()).toEqual(await f.db.journal_revisions.toArray())
  const old=(await f.repository.readJournal(f.journalId)).device
  const fresh=(await target.repository.readJournal(f.journalId)).device
  expect(fresh.deviceId).not.toBe(old.deviceId);expect(fresh.cloudEnabled).toBe(false)
  expect(await target.db.sync_queue.count()).toBe(0)
 })
 it('restores with recovery and prepares a new phrase without changing JEK/recovery/history or source bytes',async()=>{
  const f=await source();const bytes=await f.service.prepareEncryptedBackup(f.session);const original=bytes.slice()
  const target=await connect();const h=await target.service.prepareBackupRestore(bytes,f.recoveryKey,'recovery')
  await expect(target.service.commitBackupRestore(h)).rejects.toMatchObject({code:'INVALID_CONFIRMATION'})
  await target.service.setRestorePassphrase(h,'Replacement synthetic restore phrase','Replacement synthetic restore phrase')
  const result=await target.service.commitBackupRestore(h)
  expect((await target.service.readEntry(result.session,f.root.entryId)).payload.body).toBe('Synthetic final exported body')
  const keys=(await target.repository.readJournal(f.journalId)).keys
  expect(keys.recoveryWrappedKey).toEqual((await f.repository.readJournal(f.journalId)).keys.recoveryWrappedKey)
  await expect(target.service.unlockJournal(f.journalId,phrase)).rejects.toThrow()
  expect(await target.service.unlockJournal(f.journalId,'Replacement synthetic restore phrase')).toHaveProperty('close')
  expect(bytes).toEqual(original)
 })
 it('preserves retained Trash and authenticated deletion markers without deleted ciphertext',async()=>{
  const f=await source();const other=await f.service.createEntry(f.session,{title:'Synthetic trash title',body:'Synthetic trash body'})
  const trash=await f.service.prepareTrash(f.session,f.root.entryId,(await f.service.listEntries(f.session)).find(p=>p.entryId===f.root.entryId)!.headRevisionIds[0]!)
  await f.service.commitWrite(f.session,trash)
  const d=await f.service.prepareTrash(f.session,other.entryId,other.revisionId);await f.service.commitWrite(f.session,d)
  await f.service.commitPermanentDelete(f.session,await f.service.preparePermanentDelete(f.session,other.entryId,d.revision.revisionId,'manual',true))
  const bytes=await f.service.prepareEncryptedBackup(f.session);const doc=parseBackup(bytes)
  expect(doc.tombstones).toHaveLength(1);expect(doc.revisions.every(r=>r.entryId!==other.entryId)).toBe(true)
  const target=await connect();const h=await target.service.prepareBackupRestore(bytes,phrase,'passphrase');const restored=await target.service.commitBackupRestore(h)
  expect(await target.service.listTrashViews(restored.session)).toHaveLength(1)
  expect(await target.service.listEntries(restored.session)).toEqual([])
  await expect(target.service.readEntry(restored.session,other.entryId)).rejects.toMatchObject({code:'ENTRY_DELETED'})
  await target.service.rebuildProjections(restored.session);expect(await target.db.journal_tombstones.count()).toBe(1)
 })
 it.each(['truncate','duplicate key','order','unsupported','BOM','malformed UTF8','omit entry','modify config','modify wrapper','tamper tag'] as const)('rejects %s without any target write',async(kind)=>{
  const f=await source();const bytes=await f.service.prepareEncryptedBackup(f.session);const target=await connect()
  let text=new TextDecoder().decode(bytes);let candidate:Uint8Array
  const doc=JSON.parse(text) as Record<string,unknown>
  if(kind==='truncate')candidate=bytes.subarray(0,bytes.length-1)
  else if(kind==='duplicate key')candidate=new TextEncoder().encode(text.replace('"version":2','"version":2,"version":2'))
  else if(kind==='order')candidate=new TextEncoder().encode(JSON.stringify(doc,null,2))
  else if(kind==='BOM')candidate=new TextEncoder().encode('\ufeff'+text)
  else if(kind==='malformed UTF8')candidate=new Uint8Array([255])
  else {
   if(kind==='unsupported')doc.version=1
   if(kind==='omit entry')doc.revisions=[]
   if(kind==='modify config')(doc.journalConfig as {createdAt:string}).createdAt='2020-01-01T00:00:00.000Z'
   if(kind==='modify wrapper')(doc.journalKeys as {passphraseWrappedKey:{nonce:string}}).passphraseWrappedKey.nonce='A'.repeat(16)
   if(kind==='tamper tag')(doc.authentication as {tag:string}).tag='A'.repeat(22)
   text=JSON.stringify(doc);candidate=new TextEncoder().encode(text)
  }
  await expect(target.service.prepareBackupRestore(candidate,phrase,'passphrase')).rejects.toThrow()
  await emptyStores(target.db)
 })
 it('rejects oversize input before KDF and never overwrites a nonempty target',async()=>{
  const f=await source();const bytes=await f.service.prepareEncryptedBackup(f.session)
  const target=await connect();const derive=vi.spyOn(crypto.subtle,'unwrapKey')
  await expect(target.service.prepareBackupRestore(new Uint8Array(MAX_BACKUP_BYTES+1),phrase,'passphrase')).rejects.toMatchObject({code:'EXPORT_TOO_LARGE'})
  expect(derive).not.toHaveBeenCalled()
  const before=await rawStores(f.db)
  await expect(f.service.prepareBackupRestore(bytes,phrase,'passphrase')).rejects.toMatchObject({code:'JOURNAL_EXISTS'})
  expect(await rawStores(f.db)).toEqual(before)
 })
 it('detects an export snapshot race and does not emit a partial/revoked artifact',async()=>{
  const f=await source();const read=f.repository.readJournalSnapshot.bind(f.repository);let reads=0
  vi.spyOn(f.repository,'readJournalSnapshot').mockImplementation(async(...args)=>{
   if(++reads===2)await f.service.createEntry(f.session,{title:'Synthetic concurrent export',body:'Synthetic concurrent body'})
   return read(...args)
  })
  await expect(f.service.prepareEncryptedBackup(f.session)).rejects.toMatchObject({code:'STALE_SNAPSHOT'})
  vi.restoreAllMocks();const abort=new AbortController();abort.abort()
  await expect(f.service.prepareEncryptedBackup(f.session,abort.signal)).rejects.toThrow()
  await expect(f.service.prepareReadableExport(f.session,false)).rejects.toMatchObject({code:'INVALID_CONFIRMATION'})
 })
 it('reconciles a committed restoration whose receipt is lost, without duplicating records',async()=>{
  const f=await source();const target=await connect();const h=await target.service.prepareBackupRestore(await f.service.prepareEncryptedBackup(f.session),phrase,'passphrase')
  const plan=target.service.backupRestorePlan(h)!
  const commit=target.repository.restoreJournal.bind(target.repository)
  vi.spyOn(target.repository,'restoreJournal').mockImplementationOnce(async(...args)=>{await commit(...args);throw new JournalError('COMMIT_UNCERTAIN')})
  const result=await target.service.commitBackupRestore(h)
  expect(await target.service.inspectBackupRestore(result.session,plan)).toBe(true)
  expect(await target.db.journal_revisions.count()).toBe(2)
  await expect(target.service.commitBackupRestore(h)).rejects.toMatchObject({code:'LOCKED'})
 })
 it.each(['journal_config','journal_keys','device_config','journal_revisions','journal_entries'] as const)('rolls back failed import at %s',async(store)=>{
  const f=await source();const target=await connect();const h=await target.service.prepareBackupRestore(await f.service.prepareEncryptedBackup(f.session),phrase,'passphrase')
  target.db.table(store).hook('creating',()=>{throw new DOMException('Synthetic import quota','QuotaExceededError')})
  await expect(target.service.commitBackupRestore(h)).rejects.toThrow();await emptyStores(target.db)
 })
 it('requires current-phrase authentication, then changes only the passphrase wrapper using exact CAS',async()=>{
  const f=await source();const before=await rawStores(f.db)
  await expect(f.service.preparePassphraseChange(f.session,'wrong','New synthetic change phrase','New synthetic change phrase')).rejects.toThrow()
  expect(await rawStores(f.db)).toEqual(before)
  const prepared=await f.service.preparePassphraseChange(f.session,phrase,'New synthetic change phrase','New synthetic change phrase')
  const result=await f.service.commitPassphraseReset(prepared.handle,prepared.plan)
  expect((await f.service.readEntry(result.session,f.root.entryId)).payload.body).toBe('Synthetic final exported body')
  expect(await f.db.journal_revisions.toArray()).toEqual(before.journal_revisions)
  await expect(f.service.listEntries(f.session)).rejects.toMatchObject({code:'AUTHORIZATION_CHANGED'})
 })
 it('readable export includes active conflicting heads, excludes Trash/history and renders literal content',async()=>{
  const f=await source();const base=(await f.service.listEntries(f.session))[0]!.headRevisionIds[0]!
  const a=await f.service.prepareEdit(f.session,f.root.entryId,base,{title:'Synthetic <script> title',body:'Synthetic ``` body A'})
  const b=await f.service.prepareEdit(f.session,f.root.entryId,base,{title:'Synthetic version B',body:'Synthetic body B'})
  await f.service.commitWrite(f.session,a);await f.service.commitWrite(f.session,b)
  const trashRoot=await f.service.createEntry(f.session,{title:'Synthetic omitted Trash',body:'Synthetic omitted trash body'})
  await f.service.commitWrite(f.session,await f.service.prepareTrash(f.session,trashRoot.entryId,trashRoot.revisionId))
  const bytes=await f.service.prepareReadableExport(f.session,true);const text=new TextDecoder().decode(bytes)
  expect(text).toContain('Unresolved active version');expect(text).toContain('Synthetic ``` body A');expect(text).toContain('Synthetic body B')
  expect(text).not.toContain('Synthetic omitted trash body');expect(text).not.toContain('Synthetic final exported body')
  expect(text).toContain('````text');expect(text).not.toContain(phrase);expect(text).not.toContain(f.recoveryKey)
 })
})
