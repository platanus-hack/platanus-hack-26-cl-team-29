# Reglas del SII que rechazan un envío en certificación

Fecha: 2026-11-21 11:24
Autor: Luciano Saavedra Reyes

## Contexto
El módulo `server/sii/` firma, timbra y sube documentos al ambiente de certificación (`maullin.sii.cl` y `ws2.sii.cl`). Varias reglas del SII no están a la vista en los manuales y, si se rompen, el SII rechaza el envío completo o lo deja en un estado ambiguo. Esto resume las que el código ya respeta, a partir de la documentación pública del SII y de la experiencia previa del equipo.

## Hallazgo
- **Firma (XMLDSig).** Enveloped, C14N 2001, RSA-SHA1 y digest SHA-1, con `KeyValue` y `X509Certificate`; la `Signature` es el último hijo del padre (`DTE` o `EnvioDTE`). La canonicalización escapa en el texto solo `&`, `<`, `>` y CR: escapar `'` o `"` cambia el digest. El `xmlns="http://www.sii.cl/SiiDte"` del `<DTE>` entra en el digest del `<Documento>`, así que no se puede quitar ni mover al armar el sobre.
- **Codificación.** El sobre se declara y se sube en ISO-8859-1, pero los digest se calculan sobre UTF-8. Un carácter fuera de Latin-1 se corrompe al convertir: se limpia antes de firmar.
- **Líneas largas.** Una línea de más de unos 4090 caracteres se rechaza (`CHR-00002`). Encabezado, cada `Detalle`, cada `Referencia` y el TED van en su propia línea.
- **Timbre (TED).** `FRMT` firma los bytes exactos del `<DD>` en Latin-1 con la llave del CAF; el `<CAF>` va sin modificar. `RSR` e `IT1` van plegados a ASCII y recortados a 40 caracteres. `RE` va sin ceros a la izquierda. El CAF de factura y nota de crédito vence a los 6 meses de su fecha de autorización.
- **Carátula.** `RutReceptor` es siempre el SII (`60803000-K`), `RutEnvia` es el titular del certificado y en certificación `NroResol` es 0 con la fecha de resolución de certificación.
- **Subida.** `STATUS 0` solo dice que el sobre llegó; el veredicto se consulta después por track id (`EPR` = procesado, con el detalle por tipo). `DTEUpload` en maullin corta entre el 10 y el 40 % de las subidas con `ECONNRESET`, y en esos casos el sobre no llegó. Por eso la subida nunca se reintenta sola: un corte vuelve como `incierto` y antes de reenviar se consulta el folio con QueryEstDte (`FAU` = no recibido).
- **Token.** La semilla dura unos 2 minutos: se firma y se canjea de inmediato. `ESTADO 001` es token vencido o inexistente: se pide uno nuevo y se reintenta una vez.
- **QueryEstDte.** La fecha va `DDMMAAAA`; en formato ISO el SII responde "ERROR INTERNO".
- **Reclamos.** Solo tipos 33, 34 y 43, dentro de 8 días desde la recepción. `codResp` 7 (evento ya registrado) es un éxito para quien reintenta; 16 y 18 son datos, no errores.
- **Ritmo.** El SII recomienda como máximo 1 solicitud por segundo; el módulo pone todas sus llamadas en una cola por proceso.

## Consecuencias
- Quien use `server/sii/index.ts` debe tratar `envio.estado === 'incierto'` consultando `estadoDocumento` antes de volver a emitir con el mismo folio.
- Los puntos aún sin verificar en vivo con este código quedan para la primera corrida de `scripts/sii-humo.ts`: aceptación del sobre (`EPR` con el documento aceptado), formato real de la respuesta de `listarEventosHistDoc` y el tiempo que tarda maullin en procesar.
