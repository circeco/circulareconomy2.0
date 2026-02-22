import { Injectable } from '@angular/core';

export interface EventItem {
  id: string;
  title: string;
  description: string;
  category: string;
  location: string;
  time: string;
  image: string;
  date: Date;
  dateStr: string;
}

export const EVENT_CATEGORIES = [
  { id: 'all', label: 'All', icon: '●' },
  { id: 'repair', label: 'Repair', icon: '🔧' },
  { id: 'recycle', label: 'Recycle', icon: '♻' },
  { id: 'share', label: 'Share', icon: '↗' },
  { id: 'reuse', label: 'Reuse', icon: '📦' },
] as const;

@Injectable({ providedIn: 'root' })
export class EventsService {
  private readonly eventsData: EventItem[] = [
    {
      id: '1',
      title: 'Clothing Swap',
      description:
        'Swap your gently used clothes and find new-to-you items. Bring clothes to trade and leave with a refreshed wardrobe.',
      category: 'share',
      location: 'Norrtullsgatan 31, Stockholm',
      time: 'Sat 10AM-2PM',
      image: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=300&fit=crop',
      date: new Date(2025, 11, 20),
      dateStr: 'December 20th, 2025',
    },
    {
      id: '2',
      title: 'Repair Workshop',
      description:
        "Learn to fix electronics, furniture, and household items with expert volunteers. Bring your broken items and we'll help you repair them.",
      category: 'repair',
      location: 'Hagagatan 3, Stockholm',
      time: 'Sun 1PM-5PM',
      image: 'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=400&h=300&fit=crop',
      date: new Date(2026, 1, 17),
      dateStr: 'February 17th, 2026',
    },
    {
      id: '3',
      title: 'Garden Day',
      description:
        'Grow food together and learn about sustainable agriculture. Join us for planting, harvesting, and workshops.',
      category: 'share',
      location: 'Nybrogatan 44, Stockholm',
      time: 'Wed 9AM-12PM',
      image: 'https://images.unsplash.com/photo-1592150621744-aca64f48394a?w=400&h=300&fit=crop',
      date: new Date(2026, 1, 18),
      dateStr: 'February 18th, 2026',
    },
    {
      id: '4',
      title: 'Recycling Workshop',
      description:
        'Educational center for proper recycling and waste reduction. Learn what can be recycled and how to reduce your waste footprint.',
      category: 'recycle',
      location: 'Norrtullsgatan 9, Stockholm',
      time: 'Tue 2PM-4PM',
      image: 'https://images.unsplash.com/photo-1532996122724-e3c354a0b15b?w=400&h=300&fit=crop',
      date: new Date(2026, 1, 25),
      dateStr: 'February 25th, 2026',
    },
    {
      id: '5',
      title: 'Tool Library Open Day',
      description:
        'Borrow tools and equipment for your DIY projects. Membership is free for the community.',
      category: 'reuse',
      location: 'Handenterminalen 5, Stockholm',
      time: 'Sat 9AM-3PM',
      image: 'https://images.unsplash.com/photo-1504148455328-c376907d081c?w=400&h=300&fit=crop',
      date: new Date(2026, 2, 1),
      dateStr: 'March 1st, 2026',
    },
  ];

  getEvents(): EventItem[] {
    return [...this.eventsData];
  }

  getEventById(id: string): EventItem | undefined {
    return this.eventsData.find((e) => e.id === id);
  }
}
