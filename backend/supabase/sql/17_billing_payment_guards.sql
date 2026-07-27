-- 17_billing_payment_guards.sql — Payment integrity guards.
-- Run AFTER 03_rls_storage.sql. Idempotent.
--
-- Adds a BEFORE INSERT/UPDATE trigger on public.payments that:
--   1. ensures the parent invoice belongs to the same workspace as the payment,
--   2. prevents payments that would exceed the invoice total.

begin;

create or replace function public.validate_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv_workspace_id uuid;
  invoice_total numeric(12,2);
  paid_total numeric(12,2);
begin
  -- Load the invoice referenced by the payment.
  select workspace_id, total
  into inv_workspace_id, invoice_total
  from public.invoices
  where id = new.invoice_id;

  if not found then
    raise exception 'Invoice % not found.', new.invoice_id;
  end if;

  -- 1. Workspace isolation: the invoice must belong to the payment workspace.
  if inv_workspace_id is distinct from new.workspace_id then
    raise exception 'Payment invoice does not belong to the payment workspace.';
  end if;

  -- 2. Over-payment guard: cumulative payments cannot exceed the invoice total.
  select coalesce(sum(amount), 0)
  into paid_total
  from public.payments
  where invoice_id = new.invoice_id
    and id is distinct from new.id;

  if paid_total + new.amount > invoice_total then
    raise exception
      'Payment amount % exceeds the remaining invoice balance (%).',
      new.amount,
      invoice_total - paid_total;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_payment on public.payments;
create trigger trg_validate_payment
  before insert or update on public.payments
  for each row
  execute function public.validate_payment();

commit;
