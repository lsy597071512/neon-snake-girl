import { maybeProposeDisciplineInvite } from '../src/ai/disciplineSession.ts';
import { createDefaultAiLiving } from '../src/ai/worldClock.ts';

let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log('OK:', message);
    return;
  }
  console.error('FAIL:', message);
  failed += 1;
}

function createSave() {
  return { settings: { disciplineEnabled: true } };
}

function createLiving() {
  const living = createDefaultAiLiving(0);
  living.affinities.ashcrow = 60;
  return living;
}

function setStaleInvite(living) {
  living.pendingDisciplineInvite = {
    characterId: 'ashcrow',
    proposedAt: 1,
    dayIndex: 0,
    preview: '旧邀请',
  };
}

function testRefusalsClearStaleInvite() {
  for (const dialogue of [
    '你就这么喜欢小黑屋？',
    '我都说了我在换滤芯，你还在说小黑屋。',
    '我不想去负一楼小黑屋。',
  ]) {
    const living = createLiving();
    setStaleInvite(living);
    const invite = maybeProposeDisciplineInvite(createSave(), living, 'ashcrow', dialogue);
    assert(invite === null, `refusal/non-request does not create an invite: ${dialogue}`);
    assert(!living.pendingDisciplineInvite, `refusal/non-request clears stale invite: ${dialogue}`);
  }
}

function testExplicitRequestCreatesInvite() {
  const living = createLiving();
  const invite = maybeProposeDisciplineInvite(
    createSave(),
    living,
    'ashcrow',
    '我想去负一楼小黑屋接受惩罚。',
  );
  assert(invite?.characterId === 'ashcrow', 'explicit request creates an invite');
  assert(
    invite?.preview === '苍羽·澪低声提出：想去负一楼小黑屋接受惩罚或调教。',
    'invite preview is player-facing and does not expose a skin id',
  );
}

function testPlayerMessageDoesNotCreateInvite() {
  const living = createLiving();
  const invite = maybeProposeDisciplineInvite(
    createSave(),
    living,
    'ashcrow',
    '我知道了，今天先聊到这里。',
  );
  assert(invite === null, 'player request alone does not create an invite');
}

testRefusalsClearStaleInvite();
testExplicitRequestCreatesInvite();
testPlayerMessageDoesNotCreateInvite();

if (failed > 0) {
  console.error(`\n${failed} discipline invite assertion(s) failed`);
  process.exit(1);
}

console.log('\nAll discipline invite assertions passed.');
