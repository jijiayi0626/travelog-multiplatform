import type { ChecklistItem, Expense, Footprint, Member, Moment, Profile, Trip } from './types'
import { getMeta, putOne, setMeta } from './db'
import { addDays, assetUrl, todayStart } from './utils'

const SEEDED_KEY = 'seeded'
const SEED_TAG = 'seed-v2'

async function alreadySeeded(): Promise<boolean> {
  return (await getMeta(SEEDED_KEY)) === SEED_TAG
}

export async function seedIfNeeded(force = false): Promise<void> {
  if (!force && (await alreadySeeded())) return

  const now = Date.now()
  const start = addDays(todayStart(), -34)
  const tripId = 'trip-hokkaido'
  const secondTripId = 'trip-setouchi'

  const profile: Profile = {
    id: 'local-user',
    nickname: '陈行舟',
    avatar: '',
    createdAt: now,
  }
  await putOne('profile', profile)

  const trips: Trip[] = [
    {
      id: tripId,
      title: '北海道夏日纪行',
      destination: '日本 · 北海道',
      startDate: start,
      endDate: addDays(start, 5),
      note: '从札幌一路到函馆，海风、拉面和一整夜的路灯。',
      cover: 0,
      ownerId: profile.id,
      inviteCode: 'HK26AQ',
      createdAt: now - 40 * 864e5,
      updatedAt: now - 3 * 864e5,
      syncState: 0,
    },
    {
      id: secondTripId,
      title: '濑户内海跳岛计划',
      destination: '日本 · 高松 / 直岛',
      startDate: addDays(todayStart(), 21),
      endDate: addDays(todayStart(), 25),
      note: '三天两岛，看地中美术馆的睡莲，赶一次日落渡轮。',
      cover: 2,
      ownerId: profile.id,
      inviteCode: 'ST28K',
      createdAt: now - 6 * 864e5,
      updatedAt: now - 2 * 864e5,
      syncState: 1,
    },
  ]
  for (const trip of trips) {
    await putOne('trips', trip)
  }

  const members: Member[] = [
    {
      id: 'member-1',
      tripId,
      userId: profile.id,
      name: '陈行舟',
      role: 'owner',
      joinedAt: now - 40 * 864e5,
      emojiSeed: 17,
    },
    {
      id: 'member-2',
      tripId,
      userId: 'local-linxiaoman',
      name: '林小满',
      role: 'member',
      joinedAt: now - 38 * 864e5,
      emojiSeed: 61,
    },
    {
      id: 'member-3',
      tripId,
      userId: 'local-zhouyan',
      name: '周砚',
      role: 'member',
      joinedAt: now - 12 * 864e5,
      emojiSeed: 93,
    },
  ]
  for (const member of members) {
    await putOne('members', member)
  }

  const coast = assetUrl('seed/coast.svg')
  const street = assetUrl('seed/street.svg')
  const night = assetUrl('seed/night.svg')

  const moments: Moment[] = [
    {
      id: 'moment-1',
      tripId,
      dayIndex: 1,
      content:
        '落地时是阴天。小樽运河边的煤气灯一盏盏亮起来，风里有一点铁锈味的凉。我们在仓库群改的咖啡馆里坐到打烊。',
      locationName: '小樽运河',
      latitude: 43.1993,
      longitude: 141.0024,
      createdAt: start + 9 * 36e5,
      updatedAt: start + 9 * 36e5,
      syncState: 0,
      photos: [{ id: 'p1', src: coast, caption: '运河边的傍晚' }],
    },
    {
      id: 'moment-2',
      tripId,
      dayIndex: 2,
      content:
        '缆车排了四十分钟，山顶的风把人吹得站不稳。灯亮起来的那一瞬间，队伍里所有人都安静了。',
      locationName: '函馆山',
      latitude: 41.7597,
      longitude: 140.7288,
      createdAt: addDays(start, 1) + 19 * 36e5,
      updatedAt: addDays(start, 1) + 19 * 36e5,
      syncState: 0,
      photos: [
        { id: 'p2', src: night, caption: '函馆夜景' },
        { id: 'p3', src: street, caption: '山脚的电车街' },
      ],
    },
    {
      id: 'moment-3',
      tripId,
      dayIndex: 3,
      content:
        '狸小路后面一条巷子里，只有六个座位的小店。老板会一点点中文，送了我们一小碟腌海胆。',
      locationName: '狸小路商店街',
      latitude: 43.0554,
      longitude: 141.3535,
      createdAt: addDays(start, 2) + 20 * 36e5,
      updatedAt: addDays(start, 2) + 20 * 36e5,
      syncState: 0,
      photos: [{ id: 'p4', src: street, caption: '巷子里的居酒屋' }],
    },
  ]
  for (const moment of moments) {
    await putOne('moments', moment)
  }

  const expenses: Expense[] = [
    {
      id: 'expense-1',
      tripId,
      amount: 3860,
      category: 'food',
      note: '海鲜烧烤 · 两人',
      spentAt: addDays(start, 1),
      createdAt: now,
      syncState: 0,
    },
    {
      id: 'expense-2',
      tripId,
      amount: 1240,
      category: 'transport',
      note: 'JR 特急 · 札幌到函馆',
      spentAt: addDays(start, 2),
      createdAt: now,
      syncState: 0,
    },
    {
      id: 'expense-3',
      tripId,
      amount: 6800,
      category: 'stay',
      note: '温泉旅馆一晚',
      spentAt: addDays(start, 2),
      createdAt: now,
      syncState: 0,
    },
    {
      id: 'expense-4',
      tripId,
      amount: 920,
      category: 'ticket',
      note: '函馆山缆车',
      spentAt: addDays(start, 1),
      createdAt: now,
      syncState: 0,
    },
    {
      id: 'expense-5',
      tripId,
      amount: 470,
      category: 'shopping',
      note: '六花亭与玻璃小物',
      spentAt: addDays(start, 3),
      createdAt: now,
      syncState: 0,
    },
  ]
  for (const expense of expenses) {
    await putOne('expenses', expense)
  }

  const checklistFirst: ChecklistItem[] = [
    { id: 'check-1', tripId, title: '护照与复印件', done: true, createdAt: now - 5 },
    { id: 'check-2', tripId, title: '转换插头', done: true, createdAt: now - 4 },
    { id: 'check-3', tripId, title: '防晒霜与墨镜', done: false, createdAt: now - 3 },
    { id: 'check-4', tripId, title: '提前买好 JR Pass', done: false, createdAt: now - 2 },
  ]
  const checklistSecond: ChecklistItem[] = [
    { id: 'check-5', tripId: secondTripId, title: '地中美术馆预约', done: false, createdAt: now - 1 },
    { id: 'check-6', tripId: secondTripId, title: '查好渡轮班次', done: false, createdAt: now },
  ]
  for (const item of [...checklistFirst, ...checklistSecond]) {
    await putOne('checklist', item)
  }

  const footprints: Footprint[] = [
    {
      id: 'foot-1',
      tripId,
      placeName: '小樽运河',
      city: '小樽',
      latitude: 43.1993,
      longitude: 141.0024,
      note: '傍晚六点后灯才亮',
      visitedAt: start,
      createdAt: now,
    },
    {
      id: 'foot-2',
      tripId,
      placeName: '函馆山',
      city: '函馆',
      latitude: 41.7597,
      longitude: 140.7288,
      note: '夜景，风大',
      visitedAt: addDays(start, 1),
      createdAt: now,
    },
    {
      id: 'foot-3',
      tripId,
      placeName: '狸小路商店街',
      city: '札幌',
      latitude: 43.0554,
      longitude: 141.3535,
      note: '',
      visitedAt: addDays(start, 2),
      createdAt: now,
    },
  ]
  for (const footprint of footprints) {
    await putOne('footprints', footprint)
  }

  await setMeta(SEEDED_KEY, SEED_TAG)
  await setMeta('seeded-at', String(now))
}