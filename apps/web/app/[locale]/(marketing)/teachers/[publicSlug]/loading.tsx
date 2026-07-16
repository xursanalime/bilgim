import { LoadingState } from '../../../../../components/states';

export default function TeacherProfileLoading() {
  return (
    <section>
      <div className="mx-auto max-w-5xl px-4 pb-24 pt-12 sm:px-6 lg:px-8">
        <LoadingState variant="page" label="Ustoz profili yuklanmoqda" />
      </div>
    </section>
  );
}
