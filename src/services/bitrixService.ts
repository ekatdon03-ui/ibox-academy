
export interface BitrixUser {
  ID: string;
  NAME: string;
  LAST_NAME: string;
  SECOND_NAME?: string;
  EMAIL: string;
  PERSONAL_PHOTO?: string;
  UF_DEPARTMENT: number[];
  WORK_POSITION?: string;
  IS_ADMIN: boolean;
}

export interface BitrixDepartment {
  ID: string;
  NAME: string;
  PARENT?: string;
}

class BitrixService {
  private bx24: any;

  constructor() {
    this.bx24 = (window as any).BX24;
  }

  isAvailable(): boolean {
    return !!this.bx24;
  }

  init(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.bx24) {
        console.warn("Bitrix24 SDK not found. Running in standalone mode.");
        resolve();
        return;
      }
      this.bx24.init(() => resolve());
    });
  }

  callMethod(method: string, params: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.bx24) {
        reject(new Error("Bitrix24 SDK not initialized"));
        return;
      }
      this.bx24.callMethod(method, params, (result: any) => {
        if (result.error()) {
          reject(new Error(result.error()));
        } else {
          resolve(result.data());
        }
      });
    });
  }

  async getCurrentUser(): Promise<BitrixUser | null> {
    try {
      const data = await this.callMethod("user.current");
      return data;
    } catch (error) {
      console.error("Error fetching current Bitrix user:", error);
      return null;
    }
  }

  async getAllUsers(): Promise<BitrixUser[]> {
    try {
      // user.get returns all active users by default
      const users = await this.callMethod("user.get", { ACTIVE: "Y" });
      return users;
    } catch (error) {
      console.error("Error fetching all Bitrix users:", error);
      return [];
    }
  }

  async getDepartments(): Promise<BitrixDepartment[]> {
    try {
      const depts = await this.callMethod("department.get");
      return depts;
    } catch (error) {
      console.error("Error fetching Bitrix departments:", error);
      return [];
    }
  }

  async syncToFirestore(contentService: any): Promise<{ usersCount: number; deptsCount: number }> {
    if (!this.isAvailable()) return { usersCount: 0, deptsCount: 0 };
    
    try {
      const [bxUsers, bxDepts] = await Promise.all([
        this.getAllUsers(),
        this.getDepartments()
      ]);

      const deptMap: Record<string, string> = {};
      bxDepts.forEach((d: any) => {
        deptMap[d.ID] = d.NAME;
      });

      let updatedCount = 0;
      for (const bu of bxUsers) {
        const profile = {
          id: bu.ID,
          name: `${bu.NAME || ''} ${bu.LAST_NAME || ''}`.trim(),
          email: bu.EMAIL,
          position: bu.WORK_POSITION || 'Сотрудник iBOX',
          department: bu.UF_DEPARTMENT && bu.UF_DEPARTMENT[0] ? deptMap[bu.UF_DEPARTMENT[0]] : 'Общий отдел',
          role: bu.IS_ADMIN ? 'admin' : 'employee',
          avatar: bu.PERSONAL_PHOTO || '',
        };

        await contentService.saveProfile(profile);
        if (bu.IS_ADMIN) {
          await contentService.setUserRole(bu.ID, 'admin');
        }
        updatedCount++;
      }

      return { usersCount: updatedCount, deptsCount: bxDepts.length };
    } catch (error) {
      console.error("Sync to Firestore failed:", error);
      throw error;
    }
  }

  // Set the app height to fit Bitrix24 iframe
  resize(height: number = 800) {
    if (this.bx24) {
      this.bx24.resizeWindow(window.innerWidth, height);
    }
  }
}

export const bitrixService = new BitrixService();
