import "server-only";

/**
 * Tables the admin assistant may read, with the columns it may see ("col>table" = a link it can embed).
 * Map shapes, file paths, payment tokens, one-time codes, verify codes and system counters are left out on purpose.
 * Reads go through the admin's own session, so row-level security still decides which rows come back.
 */
export const READABLE: Record<string, string> = {
  appeals: "id assessment_id>assessments parcel_id>parcels reason requested_total status filed_by filed_at decided_by decided_at decision_note new_assessment_id>assessments",
  application_documents: "id application_id>applications doc_type>document_types file_name mime_type size_bytes status review_note uploaded_by uploaded_at deleted_at",
  application_events: "id application_id>applications action from_status to_status note actor_id at",
  application_parties: "application_id>applications party_id>parties role share_pct added_by added_at",
  applications: "id number type status channel district_id>districts neighbourhood_id>neighbourhoods address_note plot_no old_deed_no govt_file_no applicant_party_id>parties submitted_at decided_at decision_note created_at updated_at created_by fee_status fee_note parcel_id>parcels verified_by verified_at house_no govt_receipt_no site_check_status site_check_surveyor site_check_note property_type land_use flat_no",
  assessments: "id number parcel_id>parcels district_id>districts year land_use developed area_m2 rate_m2 land_amount buildings_amount exemption_pct exemption_amount service_charge total override_note status supersedes_id>assessments created_at created_by",
  audit_log: "id at actor_id actor_email action table_name record_id before after ip request_id",
  billing_runs: "id number year period fee_type_id>fee_types district_ids issue_date due_date status invoice_count total note created_at created_by submitted_at approved_by approved_at issued_at cancelled_by cancelled_at cancel_reason",
  buildings: "id parcel_id>parcels grade_id>property_grades units floors area_m2 use note created_at deleted_at",
  cashier_reconciliation_lines: "id reconciliation_id>cashier_reconciliations channel payments recorded actual difference shortage excess",
  cashier_reconciliations: "id number cashier_id district_id>districts business_date status recorded actual difference note prepared_by prepared_at decided_by decided_at decision_note",
  cashier_shifts: "id number pos_id>points_of_sale cashier_id district_id>districts opened_at opening_float closed_at expected_cash counted_cash difference status close_note approved_by approved_at",
  court_orders: "id parcel_id>parcels district_id>districts dispute_id>disputes order_no court order_date kind description active created_by created_at lifted_by lifted_at lift_note",
  credit_notes: "id number invoice_id>invoices amount reason status requested_by requested_at decided_by decided_at decision_note",
  disputes: "id number parcel_id>parcels district_id>districts kind description claimant_name claimant_phone court_case_no status opened_by opened_at resolved_by resolved_at resolution",
  districts: "id region_id>regions code name_so name_en manager_user_id created_at deleted_at",
  document_types: "code name_so name_en description required_for sort",
  exemptions: "id parcel_id>parcels kind pct reason valid_from valid_to status requested_by requested_at decided_by decided_at decision_note",
  facilities: "id district_id>districts kind name_so name_en created_at deleted_at",
  fee_types: "id code name_so name_en interval amount active sort",
  gl_accounts: "code name_so name_en type active",
  invoice_lines: "id invoice_id>invoices kind description amount created_at",
  invoices: "id number parcel_id>parcels district_id>districts fee_type_id>fee_types period run_id>billing_runs assessment_id>assessments issue_date due_date discount_until currency total paid credited balance status penalty_applied_at note cancel_reason created_at created_by",
  issued_documents: "id type serial parcel_id>parcels party_id>parties district_id>districts status issued_at issued_by expires_at print_count replaces_id>issued_documents cancelled_at cancelled_by cancel_reason",
  journal_entries: "id number entry_date source source_id memo total created_at",
  journal_lines: "id entry_id>journal_entries account>gl_accounts district_id>districts debit credit",
  leases: "id number parcel_id>parcels district_id>districts lessee_party_id>parties start_date end_date annual_rent purpose status created_at ended_at end_note",
  liens: "id parcel_id>parcels district_id>districts kind holder amount reference active registered_by registered_at released_by released_at release_note",
  login_events: "id user_id email method success reason ip at",
  message_campaigns: "id number template_code>message_templates district_id>districts recipients status note created_at created_by decided_at decided_by",
  message_templates: "code channel body_so body_en description is_system active",
  messages: "id channel to_address party_id>parties lang template_code>message_templates body status attempts provider last_error district_id>districts related_kind related_id campaign_id>message_campaigns created_at sent_at",
  neighbourhood_rates: "id neighbourhood_id>neighbourhoods district_id>districts land_use developed rate_m2 service_charge valid_from note created_at",
  neighbourhoods: "id sector_id>sectors district_id>districts code name_so name_en capacity created_at deleted_at",
  objections: "id notice_id>public_notices objector_name objector_phone statement status filed_at resolved_at resolution_note",
  parcel_changes: "id number kind parcel_ids district_id>districts reason status requested_by requested_at decided_by decided_at decision_note",
  parcel_history: "id parcel_id>parcels action note actor_id at",
  parcel_owners: "id parcel_id>parcels party_id>parties role share_pct valid_from valid_to created_at",
  parcels: "id pun account_no application_id>applications district_id>districts neighbourhood_id>neighbourhoods street_id>streets plot_no deed_no govt_file_no ownership land_use developed area_m2 perimeter_m status registered_at registered_by created_at updated_at created_by deleted_at house_no govt_receipt_no locked_at lock_reason property_type flat_no plot_width_m plot_length_m delete_reason site_check_status site_check_surveyor site_check_note",
  parties: "id kind full_name mother_name gender date_of_birth nationality id_type id_number phone email address org_registration_no district_id>districts created_at created_by deleted_at registered_at registered_by delete_reason",
  payment_allocations: "id payment_id>payments invoice_id>invoices amount discount created_at",
  payment_corrections: "id number payment_id>payments reason status requested_by requested_at decided_by decided_at decision_note",
  payment_plan_installments: "id plan_id>payment_plans seq due_date amount paid",
  payment_plans: "id number parcel_id>parcels district_id>districts total instalments start_date status note requested_at decided_at",
  payment_providers: "code name method enabled",
  payment_reversals: "id payment_id>payments reason status requested_by requested_at decided_by decided_at decision_note",
  payments: "id receipt_no parcel_id>parcels district_id>districts method provider provider_ref reference currency amount amount_base unallocated status received_at pos_id>points_of_sale shift_id>cashier_shifts payer_name payer_phone note created_at created_by reversed_at reversal_reason wallet verify_status verified_by verified_at dispute_reason",
  permissions: "key module action is_special description_en sort",
  permits: "id number parcel_id>parcels district_id>districts kind description floors area_m2 applicant_name applicant_phone status fee_invoice_id>invoices conditions valid_until requested_at decided_at decision_note",
  points_of_sale: "id code name district_id>districts kind receipt_prefix active created_at",
  profiles: "user_id kind full_name email phone status all_districts last_login_at point_of_sale_id>points_of_sale created_at deleted_at",
  property_grades: "id code name_so name_en amount active sort",
  public_notices: "id application_id>applications parcel_id>parcels district_id>districts starts_at ends_at status closed_at",
  regions: "id code name_so name_en",
  reprint_requests: "id document_id>issued_documents reason fee_invoice_id>invoices status requested_by requested_at decided_by decided_at decision_note kind",
  role_permissions: "role_id>roles permission_key>permissions",
  roles: "id key name_so name_en description is_system is_protected grants_all data_scope",
  sections: "id district_id>districts code name_so name_en deleted_at",
  sectors: "id section_id>sections district_id>districts code name_so name_en deleted_at",
  streets: "id district_id>districts name_so name_en deleted_at",
  survey_zones: "id neighbourhood_id>neighbourhoods district_id>districts surveyor_id target note status assigned_by assigned_at closed_at",
  surveys: "id application_id>applications parcel_id>parcels district_id>districts surveyor_id>profiles status due_date assigned_at area_m2 accuracy_m method notes started_at submitted_at reviewed_at review_note created_at",
  transfers: "id number parcel_id>parcels district_id>districts kind declared_value status duty_invoice_id>invoices note created_by created_at submitted_at decided_by decided_at decision_note",
  user_districts: "user_id>profiles district_id>districts assigned_at",
  user_roles: "user_id>profiles role_id>roles assigned_at",
};

/** table → its readable column names. */
export const COLUMNS: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(READABLE).map(([t, cols]) => [t, new Set(cols.split(" ").map((c) => c.split(">")[0]!))]),
);

/** The schema as the model sees it in the tool description. */
export const SCHEMA_TEXT = Object.entries(READABLE)
  .map(([t, cols]) => `${t}(${cols.replace(/ /g, ", ")})`)
  .join("\n");
