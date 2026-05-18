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
  // Always read BX24 dynamically — React loads before the SDK script finishes
  private get bx24(): any {
    return (window as any).BX24 ?? null;
  }

  isAvailable(): boolean {
    return !!this.bx24;
  }

  // Wait for BX24 to become available (max 5 seconds), then call init()
  init(): Promise<void> {
    return new Promise((resolve) => {
      const tryInit = (attempt: number) => {
        const bx = (window as any).BX24;
        if (bx) {
          bx.init(() => {
            // Request full available screen width so content isn't cut off
            try {
              const w = window.screen.availWidth || window.outerWidth || 1600;
              const h = window.screen.availHeight || window.outerHeight || 900;
              bx.resizeWindow(w, h);
            } catch (_) {}
            resolve();
          });
        } else if (attempt < 20) {
          // retry every 250ms up to 5 seconds
          setTimeout(() => tryInit(attempt + 1), 250);
        } else {
          console.warn("BX24 SDK not found after waiting. Standalone mode.");
          resolve();
        }
      };
      tryInit(0);
    });
  }

  callMethod(method: string, params: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const bx = this.bx24;
      if (!bx) {
        reject(new Error("BX24 SDK not available"));
        return;
      }
      bx.callMethod(method, params, (result: any) => {
        if (result.error()) {
          reject(new Error(String(result.error())));
        } else {
          resolve(result.data());
        }
      });
    });
  }

  async getCurrentUser(): Promise<BitrixUser | null> {
    try {
      return await this.callMethod("user.current");
    } catch (error) {
      console.error("Error fetching current Bitrix user:", error);
      return null;
    }
  }

  async getAllUsers(): Promise<BitrixUser[]> {
    try {
      return await this.callMethod("user.get", { ACTIVE: "Y" });
    } catch (error) {
      console.error("Error fetching all Bitrix users:", error);
      return [];
    }
  }

  async getDepartments(): Promise<BitrixDepartment[]> {
    try {
      return await this.callMethod("department.get");
    } catch (error) {
      console.error("Error fetching Bitrix departments:", error);
      return [];
    }
  }

  async syncToFirestore(contentService: any): Promise<{ usersCount: number; deptsCount: number }> {
    if (!this.isAvailable()) return { usersCount: 0, deptsCount: 0 };

    const [bxUsers, bxDepts] = await Promise.all([
      this.getAllUsers(),
      this.getDepartments()
    ]);

    const deptMap: Record<string, string> = {};
    bxDepts.forEach((d: any) => { deptMap[d.ID] = d.NAME; });

    let updatedCount = 0;
    for (const bu of bxUsers) {
      const profile = {
        id: bu.ID,
        name: `${bu.NAME || ''} ${bu.LAST_NAME || ''}`.trim(),
        email: bu.EMAIL,
        position: bu.WORK_POSITION || 'Сотрудник iBOX',
        department: bu.UF_DEPARTMENT?.[0] ? deptMap[bu.UF_DEPARTMENT[0]] : 'Общий отдел',
        role: bu.IS_ADMIN ? 'admin' : 'employee',
        avatar: bu.PERSONAL_PHOTO || '',
      };
      await contentService.saveProfile(profile);
      if (bu.IS_ADMIN) await contentService.setUserRole(bu.ID, 'admin');
      updatedCount++;
    }

    return { usersCount: updatedCount, deptsCount: bxDepts.length };
  }

  resize(height: number = 800) {
    this.bx24?.resizeWindow(window.innerWidth, height);
  }
}

export const bitrixService = new BitrixService();
