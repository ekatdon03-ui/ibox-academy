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
  UF_HEAD?: string; // Bitrix user ID of the department head
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
            // Signal installation complete so Bitrix doesn't show the install screen
            try {
              if (typeof bx.installFinish === 'function') {
                bx.installFinish();
              }
            } catch (_) {}

            // Expand frame to full screen width
            try {
              const w = window.screen.availWidth || window.outerWidth || 1920;
              bx.resizeWindow(w, 0);
            } catch (_) {}

            resolve();
          });
        } else if (attempt < 20) {
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

  // Fetches ALL pages from a list method using result.more() / result.next()
  callMethodAll(method: string, params: any = {}): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const bx = this.bx24;
      if (!bx) {
        reject(new Error("BX24 SDK not available"));
        return;
      }
      const allData: any[] = [];
      const handler = (result: any) => {
        if (result.error()) {
          reject(new Error(String(result.error())));
          return;
        }
        const page = result.data();
        if (Array.isArray(page)) {
          allData.push(...page);
        } else if (page) {
          allData.push(page);
        }
        if (result.more()) {
          result.next();
        } else {
          resolve(allData);
        }
      };
      bx.callMethod(method, params, handler);
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
      // callMethodAll paginates automatically — no 50-record cap
      return await this.callMethodAll("user.get", { ACTIVE: "Y" });
    } catch (error) {
      console.error("Error fetching all Bitrix users:", error);
      return [];
    }
  }

  async getDepartments(): Promise<BitrixDepartment[]> {
    try {
      return await this.callMethodAll("department.get");
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
    // Map of Bitrix user ID → department name they head
    const headOfDept: Record<string, string> = {};
    bxDepts.forEach((d: any) => {
      deptMap[d.ID] = d.NAME;
      if (d.UF_HEAD) headOfDept[String(d.UF_HEAD)] = d.NAME;
    });

    // Save users in parallel batches of 10 for speed
    const BATCH = 10;
    let updatedCount = 0;
    for (let i = 0; i < bxUsers.length; i += BATCH) {
      const chunk = bxUsers.slice(i, i + BATCH);
      await Promise.all(chunk.map(async (bu) => {
        const deptName = bu.UF_DEPARTMENT?.[0] ? deptMap[bu.UF_DEPARTMENT[0]] : 'Общий отдел';
        const isHead = !!headOfDept[String(bu.ID)];
        const role = bu.IS_ADMIN ? 'admin' : isHead ? 'manager' : 'employee';

        const canonicalId = `bitrix_${bu.ID}`;
        const profile = {
          id: canonicalId,
          bitrixId: String(bu.ID),
          name: `${bu.NAME || ''} ${bu.LAST_NAME || ''}`.trim(),
          email: bu.EMAIL,
          position: bu.WORK_POSITION || 'Сотрудник iBOX',
          department: deptName,
          role,
          avatar: bu.PERSONAL_PHOTO || '',
        };
        await contentService.saveProfile(profile);
        if (role === 'admin' || role === 'manager') {
          await contentService.setUserRole(canonicalId, role);
        }
        // Remove old numeric-ID duplicate if it exists
        try {
          const oldProfile = await contentService.resolveUserProfile(String(bu.ID));
          if (oldProfile) await contentService.deleteUserProfile(String(bu.ID));
        } catch (_) {}
        updatedCount++;
      }));
    }

    return { usersCount: updatedCount, deptsCount: bxDepts.length };
  }

  resize(height: number = 800) {
    this.bx24?.resizeWindow(window.innerWidth, height);
  }
}

export const bitrixService = new BitrixService();
