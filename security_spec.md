# Security Specification - iBOX Academy

## 1. Data Invariants
- Пользователи могут читать курсы, если они не скрыты (`hiddenFromUsers == false`) ИЛИ если они явно добавлены в список `assignedToUsers`.
- Результаты тестов (`results`) могут создавать любые авторизованные пользователи, но читать их могут только владельцы (`userId`) или администраторы/менеджеры.
- Уведомления (`notifications`) строго привязаны к `userId`. Пользователь может видеть только свои уведомления.
- Роли в коллекции `roles` могут изменять только администраторы.

## 2. The Dirty Dozen Payloads (Negative Tests)
1. **Identity Spoofing**: Попытка создать курс от имени другого пользователя.
2. **PII Leak**: Попытка прочитать коллекцию `users` неавторизованным пользователем.
3. **Role Escalation**: Попытка пользователя изменить свое поле `role` в коллекции `roles` или `users`.
4. **Orphaned Write**: Создание результата теста (`result`) для несуществующего курса.
5. **Notification Hijacking**: Попытка пометить уведомление другого пользователя как прочитанное.
6. **Setting Poisoning**: Попытка обычного сотрудника изменить `ai_prompts` в коллекции `settings`.
7. **Score Tampering**: Попытка напрямую изменить свой `score` через консоль Firestore.
8. **Hidden Data Scraping**: Попытка прочитать скрытые курсы (`hiddenFromUsers: true`) через прямую ссылку на ID.
9. **History Injection**: Попытка вставить ложные записи в `simulator_sessions` для другого пользователя.
10. **Admin Key Injection**: Попытка добавить свой UID в коллекцию `roles` с ролью `admin`.
11. **Bulk Delete**: Попытка очистить коллекцию `courses` не администратором.
12. **Metadata Tampering**: Попытка изменить `createdAt` на дату в прошлом.

## 3. Test Runner Configuration
Все тесты в `firestore.rules.test.ts` должны подтверждать `PERMISSION_DENIED` для этих сценариев.
