const DB_NAME = 'travelog'
const DB_VERSION = 3

export type StoreName =
  | 'trips'
  | 'moments'
  | 'expenses'
  | 'checklist'
  | 'footprints'
  | 'members'
  | 'plans'
  | 'profile'
  | 'tombstones'
  | 'meta'

const STORES: StoreName[] = [
  'trips',
  'moments',
  'expenses',
  'checklist',
  'footprints',
  'members',
  'plans',
  'profile',
  'tombstones',
  'meta',
]

interface MetaRow {
  id: string
  value: string
}

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB unavailable'))
        return
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: 'id' })
          }
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
  return dbPromise
}

async function run<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  execute: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open()
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(store, mode)
    const request = execute(transaction.objectStore(store))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  return run<T[]>(store, 'readonly', (objectStore) => objectStore.getAll() as IDBRequest<T[]>)
}

export async function getOne<T>(store: StoreName, id: string): Promise<T | undefined> {
  return run<T | undefined>(store, 'readonly', (objectStore) => objectStore.get(id) as IDBRequest<T | undefined>)
}

export async function putOne<T extends { id: string }>(store: StoreName, row: T): Promise<void> {
  await run<IDBValidKey>(store, 'readwrite', (objectStore) => objectStore.put(row))
}

export async function deleteOne(store: StoreName, id: string): Promise<void> {
  await run<undefined>(store, 'readwrite', (objectStore) => objectStore.delete(id))
}

export async function clearStore(store: StoreName): Promise<void> {
  await run<undefined>(store, 'readwrite', (objectStore) => objectStore.clear())
}

export async function getMeta(key: string): Promise<string | null> {
  const row = await getOne<MetaRow>('meta', key)
  return row ? row.value : null
}

export async function setMeta(key: string, value: string): Promise<void> {
  await putOne<MetaRow>('meta', { id: key, value })
}