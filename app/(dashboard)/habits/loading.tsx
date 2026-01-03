import { Skeleton } from "@/components/ui/skeleton";

export default function HabitsLoading() {
  return (
    <div className="flex flex-col h-full">
      <div className="border-b p-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-64 mt-2" />
      </div>
      <div className="flex-1 p-6">
        <div className="max-w-2xl mx-auto space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
