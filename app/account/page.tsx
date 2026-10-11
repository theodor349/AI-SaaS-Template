import { AccountDeletion } from "./_components/account-deletion";
import { UserDataForm } from "./_components/user-data-form";

export default function AccountPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold">Your account</h1>
      <UserDataForm />
      <AccountDeletion />
    </div>
  );
}
