import type { Footprint } from './types'
import { PROVINCES, projectLngLat, type ProvinceShape } from './chinaGeo'
import {
  citiesOfProvince,
  locateCity,
  type CityPoint,
  type DistrictPoint,
} from './chinaCities'

/* ---------------- path 解析（缓存） ---------------- */

type Ring = Array<[number, number]>

const ringCache = new Map<number, Ring[]>()

function parsePath(d: string): Ring[] {
  const rings: Ring[] = []
  let current: Ring = []
  const tokens = d.split(/(?=[MLZ])/)
  for (const token of tokens) {
    const command = token[0]
    if (command === 'Z') {
      if (current.length > 2) rings.push(current)
      current = []
      continue
    }
    if (command === 'M') {
      if (current.length > 2) rings.push(current)
      current = []
    }
    const numbers = token.slice(1).match(/-?\d+(?:\.\d+)?/g) ?? []
    for (let i = 0; i + 1 < numbers.length; i += 2) {
      current.push([Number(numbers[i]), Number(numbers[i + 1])])
    }
  }
  if (current.length > 2) rings.push(current)
  return rings
}

function ringsOf(province: ProvinceShape): Ring[] {
  const cached = ringCache.get(province.adcode)
  if (cached) return cached
  const rings = parsePath(province.path)
  ringCache.set(province.adcode, rings)
  return rings
}

/* ---------------- 点是否在多边形内 ---------------- */

function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/** 根据经纬度判断所属省级行政区 */
export function locateProvince(latitude: number, longitude: number): ProvinceShape | undefined {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined
  if (latitude === 0 && longitude === 0) return undefined
  if (longitude < 70 || longitude > 140 || latitude < 3 || latitude > 55) return undefined

  const [x, y] = projectLngLat(longitude, latitude)
  for (const province of PROVINCES) {
    const rings = ringsOf(province)
    let hit = false
    for (const ring of rings) {
      if (pointInRing(x, y, ring)) {
        hit = true
        break
      }
    }
    if (hit) return province
  }
  return undefined
}

/* ---------------- 无坐标时的城市兜底 ---------------- */

const CITY_TO_PROVINCE: Record<string, string> = {
  北京: '北京',
  天津: '天津',
  上海: '上海',
  重庆: '重庆',
  石家庄: '河北',
  唐山: '河北',
  秦皇岛: '河北',
  太原: '山西',
  大同: '山西',
  呼和浩特: '内蒙古',
  包头: '内蒙古',
  沈阳: '辽宁',
  大连: '辽宁',
  长春: '吉林',
  延吉: '吉林',
  哈尔滨: '黑龙江',
  漠河: '黑龙江',
  南京: '江苏',
  苏州: '江苏',
  无锡: '江苏',
  扬州: '江苏',
  杭州: '浙江',
  宁波: '浙江',
  温州: '浙江',
  乌镇: '浙江',
  合肥: '安徽',
  黄山: '安徽',
  福州: '福建',
  厦门: '福建',
  泉州: '福建',
  南昌: '江西',
  景德镇: '江西',
  婺源: '江西',
  济南: '山东',
  青岛: '山东',
  烟台: '山东',
  泰安: '山东',
  郑州: '河南',
  洛阳: '河南',
  开封: '河南',
  武汉: '湖北',
  宜昌: '湖北',
  长沙: '湖南',
  张家界: '湖南',
  凤凰: '湖南',
  广州: '广东',
  深圳: '广东',
  珠海: '广东',
  汕头: '广东',
  南宁: '广西',
  桂林: '广西',
  北海: '广西',
  海口: '海南',
  三亚: '海南',
  成都: '四川',
  九寨沟: '四川',
  乐山: '四川',
  贵阳: '贵州',
  昆明: '云南',
  大理: '云南',
  丽江: '云南',
  西双版纳: '云南',
  拉萨: '西藏',
  西安: '陕西',
  兰州: '甘肃',
  敦煌: '甘肃',
  西宁: '青海',
  银川: '宁夏',
  乌鲁木齐: '新疆',
  喀什: '新疆',
  台北: '台湾',
  高雄: '台湾',
  香港: '香港',
  澳门: '澳门',
}

/** 先用坐标，再用城市名兜底 */
export function provinceOfFootprint(footprint: Footprint): ProvinceShape | undefined {
  const byPoint = locateProvince(footprint.latitude, footprint.longitude)
  if (byPoint) return byPoint
  const key = (footprint.city || footprint.placeName || '').trim()
  const short = CITY_TO_PROVINCE[key]
  if (!short) return undefined
  return PROVINCES.find((item) => item.short === short)
}

/* ---------------- 聚合 ---------------- */

export interface CityVisit {
  city: CityPoint
  places: Footprint[]
  districts: Map<string, Footprint[]>
}

export interface ProvinceVisit {
  short: string
  name: string
  province: ProvinceShape | undefined
  places: Footprint[]
  cities: CityVisit[]
}

export function summarizeVisits(footprints: Footprint[]): {
  visited: Map<string, ProvinceVisit>
  overseas: Footprint[]
  unknown: Footprint[]
} {
  const visited = new Map<string, ProvinceVisit>()
  const overseas: Footprint[] = []
  const unknown: Footprint[] = []

  for (const footprint of footprints) {
    const province = provinceOfFootprint(footprint)
    if (province) {
      let entry = visited.get(province.short)
      if (!entry) {
        entry = {
          short: province.short,
          name: province.name,
          province,
          places: [],
          cities: [],
        }
        visited.set(province.short, entry)
      }
      entry.places.push(footprint)

      const located = locateCityOf(footprint, province.short)
      const locatedCity = located?.city
      if (locatedCity) {
        let cityVisit = entry.cities.find((item) => item.city.name === locatedCity.name)
        if (!cityVisit) {
          cityVisit = { city: locatedCity, places: [], districts: new Map() }
          entry.cities.push(cityVisit)
        }
        cityVisit.places.push(footprint)
        if (located.district) {
          const bucket = cityVisit.districts.get(located.district.name)
          if (bucket) bucket.push(footprint)
          else cityVisit.districts.set(located.district.name, [footprint])
        }
      }
      continue
    }
    const hasCoord = footprint.latitude !== 0 || footprint.longitude !== 0
    if (hasCoord) {
      overseas.push(footprint)
    } else {
      unknown.push(footprint)
    }
  }

  return { visited, overseas, unknown }
}

/** 足迹 → 城市 / 区县（优先坐标，其次城市名） */
export function locateCityOf(
  footprint: Footprint,
  provinceShort?: string,
): { city?: CityPoint; district?: DistrictPoint; distanceKm?: number } | undefined {
  const hit = locateCity(footprint.latitude, footprint.longitude, provinceShort)
  if (hit) return hit

  const key = (footprint.city || footprint.placeName || '').trim()
  if (!key || !provinceShort) return undefined
  const normalized = key.replace(/市$|区$|县$|镇$|街道$/g, '')
  const pool = citiesOfProvince(provinceShort)
  const city =
    pool.find((item) => item.short === normalized) ??
    pool.find((item) => item.name.startsWith(normalized)) ??
    pool.find((item) => item.districts.some((d) => d.name.startsWith(normalized)))
  if (!city) return undefined
  const district = city.districts.find(
    (item) => item.name === key || item.name.startsWith(normalized),
  )
  return { city, district }
}
