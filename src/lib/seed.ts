import type {
  ChecklistItem,
  Expense,
  Footprint,
  Member,
  Moment,
  Plan,
  Profile,
  Trip,
} from './types'
import { getMeta, putOne, setMeta } from './db'
import { addDays, assetUrl, todayStart } from './utils'

const SEEDED_KEY = 'seeded'
const SEED_TAG = 'seed-v3'

async function alreadySeeded(): Promise<boolean> {
  return (await getMeta(SEEDED_KEY)) === SEED_TAG
}

export async function seedIfNeeded(force = false): Promise<void> {
  if (!force && (await alreadySeeded())) return

  const now = Date.now()
  const start = addDays(todayStart(), -34)
  const tripId = 'trip-hokkaido'
  const secondTripId = 'trip-setouchi'
  const memoryTripId = 'trip-kyoto'
  // 精确到「去年的今天」，用于命中首页的往年回忆
  const oneYearAgo = (() => {
    const date = new Date()
    date.setFullYear(date.getFullYear() - 1)
    date.setHours(9, 0, 0, 0)
    return date.getTime()
  })()

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
      budget: 20000,
      currency: 'JPY',
      template: 'city',
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
      budget: 12000,
      currency: 'JPY',
      template: 'beach',
    },
    {
      id: memoryTripId,
      title: '京都红叶季',
      destination: '日本 · 京都',
      startDate: oneYearAgo,
      endDate: addDays(oneYearAgo, 3),
      note: '岚山的竹林、哲学之道的红枫，还有一碗凌晨的乌冬。',
      cover: 4,
      ownerId: profile.id,
      inviteCode: 'KY25R',
      createdAt: oneYearAgo - 9 * 864e5,
      updatedAt: oneYearAgo + 3 * 864e5,
      syncState: 0,
      budget: 9000,
      currency: 'JPY',
      template: 'city',
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
      tags: ['风景', '散步'],
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
      tags: ['风景', '夜生活'],
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
      tags: ['美食'],
    },
  ]

  const kyotoMoments: Moment[] = [
    {
      id: 'moment-kyoto-1',
      tripId: memoryTripId,
      dayIndex: 1,
      content:
        '清晨六点的岚山还没有人。竹林里只有风穿过竹叶的声音，像有人在很远的地方翻书。',
      locationName: '岚山竹林',
      latitude: 35.017,
      longitude: 135.6717,
      createdAt: oneYearAgo,
      updatedAt: oneYearAgo,
      syncState: 0,
      photos: [{ id: 'pk1', src: coast, caption: '竹林小径' }],
      tags: ['风景', '散步'],
    },
    {
      id: 'moment-kyoto-2',
      tripId: memoryTripId,
      dayIndex: 2,
      content:
        '哲学之道的枫叶红得很沉。走了两个小时，在路边买了一杯热甘酒，甜得有点意外。',
      locationName: '哲学之道',
      latitude: 35.0247,
      longitude: 135.7949,
      createdAt: oneYearAgo + 26 * 36e5,
      updatedAt: oneYearAgo + 26 * 36e5,
      syncState: 0,
      photos: [{ id: 'pk2', src: night, caption: '傍晚的河岸' }],
      tags: ['风景', '美食'],
    },
  ]

  for (const moment of [...moments, ...kyotoMoments]) {
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
      currency: 'JPY',
      amountCny: 3860 * 0.048,
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
      currency: 'JPY',
      amountCny: 1240 * 0.048,
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
      currency: 'JPY',
      amountCny: 6800 * 0.048,
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
      currency: 'JPY',
      amountCny: 920 * 0.048,
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
      currency: 'JPY',
      amountCny: 470 * 0.048,
    },
    {
      id: 'expense-6',
      tripId: secondTripId,
      amount: 3200,
      category: 'stay',
      note: 'Benesse House 两晚定金',
      spentAt: now - 5 * 864e5,
      createdAt: now - 5 * 864e5,
      syncState: 1,
      currency: 'CNY',
      amountCny: 3200,
    },
    {
      id: 'expense-7',
      tripId: secondTripId,
      amount: 860,
      category: 'transport',
      note: '高松往返机票',
      spentAt: now - 4 * 864e5,
      createdAt: now - 4 * 864e5,
      syncState: 1,
      currency: 'CNY',
      amountCny: 860,
    },
  ]
  for (const expense of expenses) {
    await putOne('expenses', expense)
  }

  const checklist: ChecklistItem[] = [
    { id: 'check-1', tripId, title: '护照与复印件', done: true, createdAt: now - 5 },
    { id: 'check-2', tripId, title: '转换插头', done: true, createdAt: now - 4 },
    { id: 'check-3', tripId, title: '防晒霜与墨镜', done: false, createdAt: now - 3 },
    { id: 'check-4', tripId, title: '提前买好 JR Pass', done: false, createdAt: now - 2 },
    { id: 'check-5', tripId: secondTripId, title: '地中美术馆预约', done: false, createdAt: now - 1 },
    { id: 'check-6', tripId: secondTripId, title: '查好渡轮班次', done: false, createdAt: now },
  ]
  for (const item of checklist) {
    await putOne('checklist', item)
  }

  const plans: Plan[] = [
    // 北海道（已结束的旅程，日程大多已完成）
    { id: 'plan-1', tripId, dayIndex: 1, time: '14:30', title: '落地新千岁机场', place: '新千岁机场', kind: 'transport', note: '', done: true, order: 0, createdAt: now - 40 * 864e5 },
    { id: 'plan-2', tripId, dayIndex: 1, time: '17:00', title: '入住小樽运河边的旅馆', place: '小樽', kind: 'stay', note: '', done: true, order: 1, createdAt: now - 40 * 864e5 + 1 },
    { id: 'plan-3', tripId, dayIndex: 1, time: '19:00', title: '运河边散步 + 晚餐', place: '小樽运河', kind: 'food', note: '', done: true, order: 2, createdAt: now - 40 * 864e5 + 2 },
    { id: 'plan-4', tripId, dayIndex: 2, time: '09:30', title: 'JR 特急前往函馆', place: '札幌站', kind: 'transport', note: '提前买好指定席', done: true, order: 0, createdAt: now - 39 * 864e5 },
    { id: 'plan-5', tripId, dayIndex: 2, time: '19:00', title: '函馆山夜景', place: '函馆山', kind: 'activity', note: '缆车排队约 40 分钟', done: true, order: 1, createdAt: now - 39 * 864e5 + 1 },
    { id: 'plan-6', tripId, dayIndex: 3, time: '12:00', title: '狸小路商店街', place: '札幌', kind: 'shopping', note: '', done: true, order: 0, createdAt: now - 38 * 864e5 },
    // 濑户内海（计划中，全部未完成）
    { id: 'plan-7', tripId: secondTripId, dayIndex: 1, time: '10:20', title: '高松机场落地', place: '高松机场', kind: 'transport', note: '', done: false, order: 0, createdAt: now - 6 * 864e5 },
    { id: 'plan-8', tripId: secondTripId, dayIndex: 1, time: '14:00', title: '渡轮前往直岛', place: '高松港', kind: 'transport', note: '确认班次', done: false, order: 1, createdAt: now - 6 * 864e5 + 1 },
    { id: 'plan-9', tripId: secondTripId, dayIndex: 1, time: '16:00', title: 'Benesse House 入住', place: '直岛', kind: 'stay', note: '', done: false, order: 2, createdAt: now - 6 * 864e5 + 2 },
    { id: 'plan-10', tripId: secondTripId, dayIndex: 2, time: '09:00', title: '地中美术馆', place: '直岛', kind: 'activity', note: '需提前预约', done: false, order: 0, createdAt: now - 5 * 864e5 },
    { id: 'plan-11', tripId: secondTripId, dayIndex: 2, time: '15:30', title: '草间弥生南瓜', place: '直岛', kind: 'activity', note: '', done: false, order: 1, createdAt: now - 5 * 864e5 + 1 },
    { id: 'plan-12', tripId: secondTripId, dayIndex: 3, time: '11:00', title: '丰岛美术馆', place: '丰岛', kind: 'activity', note: '', done: false, order: 0, createdAt: now - 4 * 864e5 },
    { id: 'plan-13', tripId: secondTripId, dayIndex: 3, time: '18:00', title: '返回高松', place: '高松港', kind: 'transport', note: '', done: false, order: 1, createdAt: now - 4 * 864e5 + 1 },
    // 京都（记忆中）
    { id: 'plan-14', tripId: memoryTripId, dayIndex: 1, time: '06:00', title: '岚山竹林', place: '岚山', kind: 'activity', note: '', done: true, order: 0, createdAt: oneYearAgo + 1 },
    { id: 'plan-15', tripId: memoryTripId, dayIndex: 2, time: '10:00', title: '哲学之道', place: '京都', kind: 'activity', note: '', done: true, order: 0, createdAt: oneYearAgo + 864e5 },
  ]
  for (const plan of plans) {
    await putOne('plans', plan)
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
    {
      id: 'foot-4',
      tripId: memoryTripId,
      placeName: '岚山竹林',
      city: '京都',
      latitude: 35.017,
      longitude: 135.6717,
      note: '清晨六点最安静',
      visitedAt: oneYearAgo,
      createdAt: oneYearAgo,
    },
  ]
  for (const footprint of footprints) {
    await putOne('footprints', footprint)
  }

  await setMeta(SEEDED_KEY, SEED_TAG)
  await setMeta('seeded-at', String(now))
}