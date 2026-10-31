-- NONA Custom: stickers and letters come in five pastel colours, and a customer's word is placed letter by letter.
-- Turns customer text back on (one letter per layer, real height in cm), adds the colour palette and room for a word.
UPDATE site_settings
   SET value = value || jsonb_build_object(
         'allowText', true,
         'maxTextLength', 12,
         'letterHeightCm', 4,
         'maxLayers', GREATEST(COALESCE((value ->> 'maxLayers')::int, 6), 12),
         'stickerColors', '[
           {"id":"blue","name":"Xanh dương","hex":"#aec9ea"},
           {"id":"pink","name":"Hồng","hex":"#ebb5c8"},
           {"id":"purple","name":"Tím","hex":"#c5a3e3"},
           {"id":"yellow","name":"Vàng","hex":"#f5ec9b"},
           {"id":"green","name":"Xanh lá","hex":"#b6d8b5"}
         ]'::jsonb
       ),
       version = version + 1,
       updated_at = now()
 WHERE key = 'custom';

-- Earlier multi-letter text layers are left as they are: frozen designs and orders must not change, and a draft that
-- still holds one is asked to re-enter it letter by letter the next time it is saved (the API names the layer).
