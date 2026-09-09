---
name: sdd-archive
description: Cierra un cambio SDD completado y verificado. Usar en la fase 7 del workflow.
---

# SDD — Archive

## Qué hacer

Una vez que el cambio está implementado, verificado, y la PR fue mergeada a main, cerrarlo formalmente.

### Contenido del archive
1. **Resumen**: qué se implementó
2. **Archivos tocados**: lista completa con cambios
3. **Decisiones tomadas**: las que surgieron durante implementación
4. **Deuda técnica**: si quedó algo pendiente o mejorable

### Formato

```markdown
## Archive: [nombre del cambio]

### Resumen
...

### Archivos
- `ruta/archivo.ts` — creado/modificado, responsabilidad

### Decisiones durante implementación
- ...

### Deuda técnica
- ...

### Estado
✅ Cambio completado y archivado.
```
