alter table if exists insaights_config_extraction_fields
  add column if not exists display_name text not null default '';

update insaights_config_extraction_fields
set display_name = case field_name
  when 'supplier_name' then 'Lieferantenname'
  when 'invoice_number' then 'Rechnungsnummer'
  when 'invoice_date' then 'Rechnungsdatum'
  when 'due_date' then 'Faelligkeitsdatum'
  when 'currency' then 'Waehrung'
  when 'gross_amount' then 'Bruttobetrag'
  when 'net_amount' then 'Nettobetrag'
  when 'tax_amount' then 'Steuerbetrag'
  when 'line_no' then 'Positionsnummer'
  when 'description' then 'Positionsbeschreibung'
  when 'quantity' then 'Menge'
  when 'unit_price' then 'Einzelpreis'
  when 'line_amount' then 'Positionsbetrag'
  when 'tax_rate' then 'Steuersatz'
  else field_name
end
where coalesce(display_name, '') = '';
