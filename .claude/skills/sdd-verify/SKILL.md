---
name: sdd-verify
description: Valida la implementación contra specs y tareas. Usar en la fase 6 del workflow.
---

# SDD — Verify

## Qué hacer

Verificá que la implementación cumple con todo lo especificado.

### Checklist por spec
Para cada RF de las specs:
- ✅ **Cumple** — el código hace lo que la spec pide
- ❌ **No cumple** — falta o está mal implementado
- ⚠️ **Parcial** — cubre el happy path pero faltan edge cases

### Verificaciones
1. Cada **criterio de aceptación** de las specs se cumple
2. Los **edge cases** están cubiertos
3. El **diseño** se respetó (archivos, flujo, contratos)

### Formato de salida

```markdown
## Verify: [nombre del cambio]

### RF1: [título] → ✅ | ❌ | ⚠️
- Criterio 1: ✅
- Criterio 2: ⚠️ (cubre happy pero no edge case X)

### RF2: [título] → ...
```

Si hay ❌ o ⚠️, no cerrés el cambio hasta que se arregle.
