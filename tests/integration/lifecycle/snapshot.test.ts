// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { cleanup, content, fixture } from '../storage/fixture'
afterEach(cleanup)
it('reads a deletion snapshot with empty queue/metadata without a premature transaction commit', async () => {
 const f=await fixture();const e=await f.service.createEntry(f.session,content)
 expect(await f.repository.readDeletionSnapshot(f.journalId,e.entryId)).toMatchObject({entry:{entryId:e.entryId},operations:[],metadata:null})
})
