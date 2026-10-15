import { AccountDeletion } from "./_components/account-deletion";
import { DataExport } from "./_components/data-export";
import { UserDataForm } from "./_components/user-data-form";

export default function AccountPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold">Account</h1>
      <UserDataForm />
      <DataExport />
      <AccountDeletion />
    </div>
  );
}
