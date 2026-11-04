-- Existing characters predate the side-view-only schema.
UPDATE `characters`
SET `view_type` = 'side_scroller'
WHERE `view_type` IN ('top_down', 'three_quarter');
--> statement-breakpoint
UPDATE `characters`
SET `manifest_json` = json_set(`manifest_json`, '$.viewType', 'side_scroller')
WHERE CASE WHEN json_valid(`manifest_json`)
  THEN json_extract(`manifest_json`, '$.viewType') IN ('top_down', 'three_quarter')
  ELSE 0 END;
