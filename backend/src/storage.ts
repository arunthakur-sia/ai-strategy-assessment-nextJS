// Storage placeholder — project persistence is handled directly in routes.ts via PostgreSQL.
// This file is kept for structural consistency with the original template.

export interface IStorage {
  getUser(id: string): Promise<{ id: string; username: string } | undefined>
  getUserByUsername(username: string): Promise<{ id: string; username: string } | undefined>
  createUser(user: { username: string; password: string }): Promise<{ id: string; username: string }>
}

export class MemStorage implements IStorage {
  private users: Map<string, { id: string; username: string; password: string }>

  constructor() {
    this.users = new Map()
  }

  async getUser(id: string) {
    return this.users.get(id)
  }

  async getUserByUsername(username: string) {
    return Array.from(this.users.values()).find((u) => u.username === username)
  }

  async createUser(insertUser: { username: string; password: string }) {
    const { randomUUID } = await import('crypto')
    const id = randomUUID()
    const user = { ...insertUser, id }
    this.users.set(id, user)
    return user
  }
}

export const storage = new MemStorage()
