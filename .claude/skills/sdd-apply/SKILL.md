---
name: sdd-apply
description: Implementa las tareas definidas en SDD tasks. Usar en la fase 5 del workflow.
---

# SDD — Apply

## Qué hacer

Implementá las tareas una por una, en orden de dependencia.

### Reglas
1. **Una tarea por vez** — no mezcles tareas en un solo cambio
2. **Work-unit commits** — cada commit debe ser una unidad coherente y revisable. No separes archivos por tipo (ej: "agrego modelos", "agrego servicios"). En su lugar, agrupá todo lo necesario para una funcionalidad: `feat(auth): add login endpoint with validation and tests`
3. **Commit por tarea** — conventional commit, descriptivo
4. **No atribuyas a AI** — ni "Co-Authored-By" ni nada similar
5. Si una tarea toca **2+ archivos**, mostrá el plan antes de escribir código
6. **No modifiques archivos que no están en la tarea** sin avisar
7. **Todo commit debe poder revisarse solo** — no hagas commits de "wip", "fix", o "cambios sueltos"

### Commits
``` 
feat(scope): mensaje corto y descriptivo
fix(scope): mensaje corto
refactor(scope): mensaje corto
test(scope): mensaje corto
```

### Por tarea
1. Mostrá qué archivos vas a tocar
2. Implementá
3. Verificá que compile/ande
4. Hacé commit
5. Marcá la tarea como completa y pasá a la siguiente
