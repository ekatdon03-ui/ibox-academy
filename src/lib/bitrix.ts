/**
 * Bitrix24 Integration Mock
 * Handles BX24 initialization or provides a mock user for development
 */

export interface BitrixUser {
  id?: string;
  name: string;
  position: string;
  role: 'admin' | 'manager' | 'employee';
  avatar?: string;
  email?: string;
  department?: string;
}

export const getBitrixUser = (): BitrixUser => {
  // @ts-ignore - BX24 is usually global in Bitrix contexts
  if (typeof window !== 'undefined' && (window as any).BX24) {
    const BX24 = (window as any).BX24;
    console.log("Bitrix24 detected");
    
    // In Bitrix, we usually get current user via callMethod if not provided in placement info
    // But for direct sync in App.tsx, we can return a skeleton that will be updated
    // Or if we are in an iframe, BX24 might have some sync state
    
    // Note: BX24.isAdmin() is a synchronous check for current user rights in the portal
    const isAdmin = typeof BX24.isAdmin === 'function' ? BX24.isAdmin() : false;

    return {
      name: "Пользователь Битрикс",
      role: isAdmin ? "admin" : "employee",
      position: "Сотрудник"
    };
  }

  // Demo mode for AI Studio
  console.log("Битрикс не найден, включаем демо-режим");
  return {
    name: "Тест Админ",
    role: "admin",
    position: "Руководитель",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Admin"
  };
};

export const fetchBitrixProfile = async (): Promise<Partial<BitrixUser>> => {
  return new Promise((resolve) => {
    // @ts-ignore
    if (typeof window !== 'undefined' && (window as any).BX24) {
      const BX24 = (window as any).BX24;
      BX24.callMethod('user.current', {}, (res: any) => {
        if (res.error()) {
          console.error("Bitrix user.current error", res.error());
          resolve({});
        } else {
          const data = res.data();
          const isAdmin = BX24.isAdmin();
          
          // Department handling: Bitrix returns UF_DEPARTMENT as an array of IDs
          // In a real app we might fetch department names, for now we can signal it
          resolve({
            id: data.ID,
            name: `${data.NAME || ''} ${data.LAST_NAME || ''}`.trim(),
            position: data.WORK_POSITION,
            email: data.EMAIL,
            avatar: data.PERSONAL_PHOTO,
            role: isAdmin ? 'admin' : 'employee',
            department: data.WORK_DEPARTMENT || 'Отдел продаж'
          });
        }
      });
    } else {
      resolve({});
    }
  });
};
