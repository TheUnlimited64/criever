// Spawned as a real OS process by test/localreview.test.ts to exercise the cross-process
// lock in localreview.ts. Adds N comments to the given review file, one by one.
import { LocalReviewStore } from '../src/localreview';

const [file, countStr, author] = process.argv.slice(2) as [string, string, 'me' | 'agent'];
const count = Number(countStr);

const store = new LocalReviewStore(file);
await store.load();
for (let i = 0; i < count; i++) {
  await store.add({
    path: `${author}.ts`, line: i + 1, side: 'new', body: `${author}-${i}`,
    author, anchorCommit: 'abc',
  });
}
