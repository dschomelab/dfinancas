
-- Add parent grouping column to categories
alter table public.categories add column if not exists parent text;

-- Seed function for default expense categories
create or replace function public.seed_default_categories(_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.categories (user_id, name, type, parent) values
    (_user_id, 'Restaurante', 'expense', 'Alimentação'),
    (_user_id, 'Supermercado', 'expense', 'Alimentação'),
    (_user_id, 'Padaria', 'expense', 'Alimentação'),
    (_user_id, 'Bê', 'expense', 'Desp. Pessoais'),
    (_user_id, 'Henrique', 'expense', 'Desp. Pessoais'),
    (_user_id, 'Bar', 'expense', 'Desp. Pessoais'),
    (_user_id, 'Eletrônicos', 'expense', 'Desp. Pessoais'),
    (_user_id, 'Escritório', 'expense', 'Desp. Pessoais'),
    (_user_id, 'Estacionamento', 'expense', 'Desp. Pessoais'),
    (_user_id, 'Juros/Encargos', 'expense', 'Desp. Pessoais'),
    (_user_id, 'Férias', 'expense', 'Desp. Pessoais'),
    (_user_id, 'Hig/Beleza', 'expense', 'Desp. Pessoais'),
    (_user_id, 'Lazer', 'expense', 'Desp. Pessoais'),
    (_user_id, 'Plano Celular', 'expense', 'Desp. Pessoais'),
    (_user_id, 'Serviços', 'expense', 'Desp. Pessoais'),
    (_user_id, 'Servidor', 'expense', 'Desp. Pessoais'),
    (_user_id, 'Vestuário', 'expense', 'Desp. Pessoais'),
    (_user_id, 'Cursos', 'expense', 'Educação'),
    (_user_id, 'Faculdade', 'expense', 'Educação'),
    (_user_id, 'Água', 'expense', 'Habitação'),
    (_user_id, 'Aluguel', 'expense', 'Habitação'),
    (_user_id, 'Casa', 'expense', 'Habitação'),
    (_user_id, 'Condomínio', 'expense', 'Habitação'),
    (_user_id, 'Financiamento', 'expense', 'Habitação'),
    (_user_id, 'Saldo Entrada', 'expense', 'Habitação'),
    (_user_id, 'Energia', 'expense', 'Habitação'),
    (_user_id, 'Gás', 'expense', 'Habitação'),
    (_user_id, 'Internet', 'expense', 'Habitação'),
    (_user_id, 'IPTU', 'expense', 'Habitação'),
    (_user_id, 'Limpeza', 'expense', 'Habitação'),
    (_user_id, 'Manutenção', 'expense', 'Habitação'),
    (_user_id, 'Seguro Fiança', 'expense', 'Habitação'),
    (_user_id, 'Reforma AP 102F', 'expense', 'Patrimônio'),
    (_user_id, 'Entrada 102F', 'expense', 'Patrimônio'),
    (_user_id, 'Financiamento 102F', 'expense', 'Patrimônio'),
    (_user_id, 'AP 1808', 'expense', 'Patrimônio'),
    (_user_id, 'Resort Porto Seguro', 'expense', 'Patrimônio'),
    (_user_id, 'Academia', 'expense', 'Saúde'),
    (_user_id, 'Dentista', 'expense', 'Saúde'),
    (_user_id, 'Farmácia', 'expense', 'Saúde'),
    (_user_id, 'Plano de Saúde', 'expense', 'Saúde'),
    (_user_id, 'Suplementos', 'expense', 'Saúde'),
    (_user_id, 'Transp. Público', 'expense', 'Transporte'),
    (_user_id, 'Uber/Táxi', 'expense', 'Transporte'),
    (_user_id, 'Combustível', 'expense', 'Transporte'),
    (_user_id, 'Ações', 'expense', 'Investimentos'),
    (_user_id, 'Renda Fixa', 'expense', 'Investimentos'),
    (_user_id, 'Outros', 'expense', 'Outros'),
    (_user_id, 'Presentes', 'expense', 'Outros'),
    (_user_id, 'Pais', 'expense', 'Outros'),
    -- default income categories
    (_user_id, 'Salário', 'income', 'Receitas'),
    (_user_id, 'Freelance', 'income', 'Receitas'),
    (_user_id, 'Investimentos', 'income', 'Receitas'),
    (_user_id, 'Outros', 'income', 'Receitas')
  on conflict do nothing;
end;
$$;

-- Update handle_new_user to also seed categories
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)));
  perform public.seed_default_categories(new.id);
  return new;
end;
$$;

-- Ensure trigger exists
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill for existing users that have no categories yet
do $$
declare u record;
begin
  for u in select id from auth.users
           where not exists (select 1 from public.categories c where c.user_id = auth.users.id)
  loop
    perform public.seed_default_categories(u.id);
  end loop;
end $$;
